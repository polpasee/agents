import * as fs from "fs";
import * as path from "path";
import {
  agents,
  edges,
  teams,
  agentLastModified,
  removedAgentIds,
  agentFilePaths,
  registerAgent,
  updateAgentStatus,
  processEntry,
  parseAgentType,
  broadcast,
} from "./agent-state";
import { readNewLines, extractTaskFromJSONL, cleanupFileOffsets } from "./file-reader";
import { DISCOVERY_THRESHOLD_MS, STALE_THRESHOLD_MS, REMOVED_IDS_TTL_MS } from "./config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Selects which agents should be purged as stale. Main sessions (no parentId)
 * are protected while any of their sub-agents has activity within
 * STALE_THRESHOLD_MS — Claude often parks the main's JSONL for minutes while
 * a sub runs a long background tool, and purging the main would orphan the
 * active sub in the graph. Exported for testing.
 */
export function selectStaleAgentIds(
  agents: Map<string, { parentId?: string; status: string; startTime: number }>,
  agentLastModified: Map<string, number>,
  now: number,
): string[] {
  const freshParentIds = new Set<string>();
  for (const [childId, child] of agents) {
    if (!child.parentId) continue;
    const childLastMod = agentLastModified.get(childId) || child.startTime;
    if (now - childLastMod <= STALE_THRESHOLD_MS) {
      freshParentIds.add(child.parentId);
    }
  }
  const stale: string[] = [];
  for (const [agentId, agent] of agents) {
    if (agent.status !== "running" && agent.status !== "idle") continue;
    const lastMod = agentLastModified.get(agentId) || agent.startTime;
    if (now - lastMod <= STALE_THRESHOLD_MS) continue;
    if (!agent.parentId && freshParentIds.has(agentId)) continue;
    stale.push(agentId);
  }
  return stale;
}

export function discoverActiveSessions(projectsDir: string) {
  if (!fs.existsSync(projectsDir)) return;

  const projectDirs = fs.readdirSync(projectsDir).filter((d) => {
    const p = path.join(projectsDir, d);
    return fs.statSync(p).isDirectory();
  });

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(projectPath);
    } catch {
      continue;
    }

    // ── Step 1: Discover main session agents ──────────
    const mainJsonlFiles = entries.filter((f) => {
      if (!f.endsWith(".jsonl")) return false;
      const sessionId = f.replace(".jsonl", "");
      return UUID_RE.test(sessionId);
    });

    for (const mainJsonl of mainJsonlFiles) {
      const sessionId = mainJsonl.replace(".jsonl", "");
      const filePath = path.join(projectPath, mainJsonl);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      const age = Date.now() - stat.mtimeMs;
      if (age > DISCOVERY_THRESHOLD_MS) continue;

      if (!agents.has(sessionId)) {
        if (removedAgentIds.has(sessionId) && age > STALE_THRESHOLD_MS) continue;
        removedAgentIds.delete(sessionId);

        const info = extractTaskFromJSONL(filePath);
        agentFilePaths.set(sessionId, filePath);
        registerAgent({
          agentId: sessionId,
          sessionId,
          projectDir,
          agentType: "main",
          task: info.task,
          slug: info.slug,
          model: info.model,
          startTime: info.startTime || stat.mtimeMs,
        });
      }

      const newLines = readNewLines(filePath);
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line);
          processEntry(entry, sessionId, sessionId);
        } catch { /* skip */ }
      }

      updateAgentStatus(sessionId, stat.mtimeMs);
    }

    // ── Step 2: Discover sub-agents ──────────────────
    const sessionDirs = entries.filter((d) => {
      const p = path.join(projectPath, d);
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });

    for (const sessionId of sessionDirs) {
      const subagentsDir = path.join(projectPath, sessionId, "subagents");
      if (!fs.existsSync(subagentsDir)) continue;

      let files: string[];
      try {
        files = fs.readdirSync(subagentsDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(subagentsDir, jsonlFile);

        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        const age = Date.now() - stat.mtimeMs;
        if (age > DISCOVERY_THRESHOLD_MS) continue;

        // Backfill the parent session if it hasn't been discovered yet —
        // the main's JSONL may be older than DISCOVERY_THRESHOLD_MS while
        // Claude is waiting on a long background tool, but the session is
        // clearly alive because this sub-agent is writing. Without this,
        // the sub-agent would render orphaned (no MAIN anchor).
        if (!agents.has(sessionId)) {
          const parentJsonl = path.join(projectPath, `${sessionId}.jsonl`);
          let parentStat: fs.Stats | undefined;
          try { parentStat = fs.statSync(parentJsonl); } catch { /* missing */ }
          if (parentStat) {
            removedAgentIds.delete(sessionId);
            const info = extractTaskFromJSONL(parentJsonl);
            agentFilePaths.set(sessionId, parentJsonl);
            registerAgent({
              agentId: sessionId,
              sessionId,
              projectDir,
              agentType: "main",
              task: info.task,
              slug: info.slug,
              model: info.model,
              startTime: info.startTime || parentStat.mtimeMs,
            });
            // Seed lastModified from the fresher of parent mtime or child mtime
            // so the main stays marked alive while the sub is active.
            updateAgentStatus(sessionId, Math.max(parentStat.mtimeMs, stat.mtimeMs));
          }
        } else {
          // Keep an already-registered parent fresh whenever a child writes,
          // so the stale-purge selector doesn't target the main mid-work.
          updateAgentStatus(sessionId, stat.mtimeMs);
        }

        const agentIdMatch = jsonlFile.match(/^agent-(.+)\.jsonl$/);
        if (!agentIdMatch) continue;
        const agentId = agentIdMatch[1];

        if (agentId.startsWith("compact-")) continue;

        let agentType: ReturnType<typeof parseAgentType> = "generic";
        let description = "";
        let teamId: string | undefined;
        let teamName: string | undefined;
        const metaFile = `agent-${agentId}.meta.json`;
        if (metaFiles.includes(metaFile)) {
          try {
            const meta = JSON.parse(
              fs.readFileSync(path.join(subagentsDir, metaFile), "utf-8")
            );
            agentType = parseAgentType(meta.agentType);
            description = meta.description || "";
            teamId = meta.teamId;
            teamName = meta.teamName;
          } catch (err) {
            console.warn(`Failed to read meta file ${metaFile}:`, err);
          }
        }

        // If no meta file, try to infer type from description
        if (agentType === "generic" && description) {
          agentType = parseAgentType(description);
        }

        if (!agents.has(agentId)) {
          if (removedAgentIds.has(agentId) && age > STALE_THRESHOLD_MS) continue;
          removedAgentIds.delete(agentId);

          agentFilePaths.set(agentId, filePath);
          const info = extractTaskFromJSONL(filePath);
          const parentId = sessionId;

          registerAgent({
            agentId,
            sessionId,
            projectDir,
            agentType,
            parentId,
            task: description || info.task,
            slug: info.slug,
            model: info.model,
            startTime: info.startTime || stat.mtimeMs,
            teamId,
            teamName,
          });
        }

        const newLines = readNewLines(filePath);
        for (const line of newLines) {
          try {
            const entry = JSON.parse(line);
            processEntry(entry, agentId, sessionId);
          } catch { /* skip */ }
        }

        updateAgentStatus(agentId, stat.mtimeMs);
      }
    }
  }

  const staleIds = selectStaleAgentIds(agents, agentLastModified, Date.now());
  for (const agentId of staleIds) {
    const agent = agents.get(agentId);
    agents.delete(agentId);
    agentLastModified.delete(agentId);
    agentFilePaths.delete(agentId);
    removedAgentIds.set(agentId, Date.now());
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === agentId || edges[i].target === agentId) {
        edges.splice(i, 1);
      }
    }
    // Remove agent from its team; delete team if empty
    if (agent?.teamId) {
      const team = teams.get(agent.teamId);
      if (team) {
        team.memberIds = team.memberIds.filter(id => id !== agentId);
        if (team.memberIds.length === 0) {
          teams.delete(agent.teamId);
        }
      }
    }
    try {
      broadcast({ type: "state:remove", agentId });
    } catch (err) {
      console.warn(`Failed to broadcast removal of ${agentId}:`, err);
    }
  }

  // Purge old entries from removedAgentIds to prevent memory leak
  const now = Date.now();
  for (const [id, removedAt] of removedAgentIds) {
    if (now - removedAt > REMOVED_IDS_TTL_MS) {
      removedAgentIds.delete(id);
    }
  }

  // Clean up file offsets for deleted files
  cleanupFileOffsets();
}
