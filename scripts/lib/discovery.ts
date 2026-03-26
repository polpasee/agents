import * as fs from "fs";
import * as path from "path";
import {
  agents,
  edges,
  agentLastModified,
  removedAgentIds,
  registerAgent,
  updateAgentStatus,
  processEntry,
  parseAgentType,
  broadcast,
} from "./agent-state";
import { readNewLines, extractTaskFromJSONL } from "./file-reader";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DISCOVERY_THRESHOLD = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

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
      if (age > DISCOVERY_THRESHOLD) continue;

      if (!agents.has(sessionId)) {
        if (removedAgentIds.has(sessionId) && age > STALE_THRESHOLD) continue;
        removedAgentIds.delete(sessionId);

        const info = extractTaskFromJSONL(filePath);
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
        if (age > DISCOVERY_THRESHOLD) continue;

        const agentIdMatch = jsonlFile.match(/^agent-(.+)\.jsonl$/);
        if (!agentIdMatch) continue;
        const agentId = agentIdMatch[1];

        if (agentId.startsWith("compact-")) continue;

        let agentType = parseAgentType();
        let description = "";
        const metaFile = `agent-${agentId}.meta.json`;
        if (metaFiles.includes(metaFile)) {
          try {
            const meta = JSON.parse(
              fs.readFileSync(path.join(subagentsDir, metaFile), "utf-8")
            );
            agentType = parseAgentType(meta.agentType);
            description = meta.description || "";
          } catch { /* ignore */ }
        }

        if (!agents.has(agentId)) {
          if (removedAgentIds.has(agentId) && age > STALE_THRESHOLD) continue;
          removedAgentIds.delete(agentId);

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

  // Remove stale agents
  for (const [agentId, agent] of agents) {
    if (agent.status === "running" || agent.status === "idle") {
      const lastMod = agentLastModified.get(agentId) || agent.startTime;
      const timeSinceModified = Date.now() - lastMod;
      if (timeSinceModified > STALE_THRESHOLD) {
        agents.delete(agentId);
        agentLastModified.delete(agentId);
        removedAgentIds.add(agentId);
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].source === agentId || edges[i].target === agentId) {
            edges.splice(i, 1);
          }
        }
        broadcast({ type: "state:remove", agentId });
      }
    }
  }
}
