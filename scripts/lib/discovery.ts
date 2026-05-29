import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import type { Stats, Dirent } from "node:fs";
import * as path from "node:path";
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
import { THINKING_EFFORTS, type ThinkingEffort } from "../../src/lib/types";
import { DISCOVERY_THRESHOLD_MS, STALE_THRESHOLD_MS, SUBAGENT_STALE_THRESHOLD_MS, REMOVED_IDS_TTL_MS, STATUS_RUNNING_THRESHOLD_MS } from "./config";

// ---------------------------------------------------------------------------
// Per-pass settings.json cache — avoids re-reading the same file for every
// agent registered during a single discovery run.
// ---------------------------------------------------------------------------

type ParsedSettings = Record<string, unknown> | null;
type SettingsCache = Map<string, ParsedSettings>;

function readSettingsCached(filePath: string, cache: SettingsCache): ParsedSettings {
  if (cache.has(filePath)) return cache.get(filePath)!;
  let result: ParsedSettings = null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to read settings ${filePath}:`, err);
    }
  }
  cache.set(filePath, result);
  return result;
}

function settingsCandidatePaths(projectDir: string): string[] {
  return [
    path.join(projectDir, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
}

function readEffortLevelCached(projectDir: string, cache: SettingsCache): ThinkingEffort | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const value = parsed?.effortLevel;
    if (typeof value === "string" && (THINKING_EFFORTS as readonly string[]).includes(value)) {
      return value as ThinkingEffort;
    }
  }
  return undefined;
}

function readIs1MContextCached(projectDir: string, cache: SettingsCache): boolean | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const model = parsed?.model;
    if (typeof model === "string") return /\[1m\]/i.test(model);
  }
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Finds redundant "main" sessions that share a projectDir and returns the
 * flat list of agent ids that should be evicted (losing mains plus each
 * losing main's descendants). The winner is the most-recently-active main
 * per `projectDir`, judged by `agentLastModified.get(id) ?? startTime`.
 *
 * Tie-break, in order: (1) higher last-modified, (2) higher startTime,
 * (3) lexically greater agent id — the last step is arbitrary but keeps
 * the result deterministic when two sessions register at the same instant.
 *
 * A loser is only evicted if its JSONL has been silent for at least
 * STATUS_RUNNING_THRESHOLD_MS — otherwise both mains are treated as
 * legitimate concurrent sessions and both stay. This preserves the
 * post-/clear ghost cleanup (where the old JSONL stops being written) while
 * letting users run two real Claude Code sessions in the same project at
 * once.
 *
 * Returns ids only; the caller is responsible for the actual purge so the
 * eviction path matches the existing tier-2 flow (broadcast, maps, edges).
 *
 * Exported for testing.
 */
export function selectLosingMains(
  agents: Map<string, { parentId?: string; startTime: number; metadata?: Record<string, unknown> }>,
  agentLastModified: Map<string, number>,
  now: number,
): string[] {
  // Group main agents (no parentId) by projectDir.
  const mainsByProject = new Map<string, string[]>();
  for (const [id, agent] of agents) {
    if (agent.parentId !== undefined) continue;
    const projectDir = agent.metadata?.projectDir;
    if (typeof projectDir !== "string" || projectDir.length === 0) continue;
    const bucket = mainsByProject.get(projectDir);
    if (bucket) bucket.push(id);
    else mainsByProject.set(projectDir, [id]);
  }

  const losingMainIds: string[] = [];
  for (const [, mainIds] of mainsByProject) {
    if (mainIds.length <= 1) continue;
    mainIds.sort((a, b) => {
      const aAgent = agents.get(a);
      const bAgent = agents.get(b);
      const aMod = agentLastModified.get(a) ?? aAgent?.startTime ?? 0;
      const bMod = agentLastModified.get(b) ?? bAgent?.startTime ?? 0;
      if (bMod !== aMod) return bMod - aMod;
      const aStart = aAgent?.startTime ?? 0;
      const bStart = bAgent?.startTime ?? 0;
      if (bStart !== aStart) return bStart - aStart;
      return b.localeCompare(a);
    });
    // Keep mainIds[0] (winner). Evict only losers whose JSONL has gone quiet
    // — a still-writing loser is a real concurrent session, not a ghost.
    for (let i = 1; i < mainIds.length; i++) {
      const id = mainIds[i];
      const mtime = agentLastModified.get(id) ?? agents.get(id)?.startTime ?? 0;
      if (now - mtime <= STATUS_RUNNING_THRESHOLD_MS) continue;
      losingMainIds.push(id);
    }
  }

  if (losingMainIds.length === 0) return [];

  // Walk descendants iteratively for each losing main. We rebuild the
  // parent→children map once so the outer loop stays O(N) regardless of
  // how many mains lose.
  const childrenByParent = new Map<string, string[]>();
  for (const [id, agent] of agents) {
    if (agent.parentId === undefined) continue;
    const siblings = childrenByParent.get(agent.parentId);
    if (siblings) siblings.push(id);
    else childrenByParent.set(agent.parentId, [id]);
  }

  const toEvict = new Set<string>(losingMainIds);
  const stack: string[] = [...losingMainIds];
  while (stack.length > 0) {
    const parent = stack.pop() as string;
    const children = childrenByParent.get(parent);
    if (!children) continue;
    for (const childId of children) {
      if (toEvict.has(childId)) continue;
      toEvict.add(childId);
      stack.push(childId);
    }
  }

  return Array.from(toEvict);
}

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
    // Protect main only while a child is actively running or waiting.
    if (child.status === "running" || child.status === "waiting") {
      freshParentIds.add(child.parentId);
    }
  }
  const stale: string[] = [];
  for (const [agentId, agent] of agents) {
    if (agent.status !== "running" && agent.status !== "idle") continue;
    const lastMod = agentLastModified.get(agentId) || agent.startTime;
    const threshold = agent.parentId ? SUBAGENT_STALE_THRESHOLD_MS : STALE_THRESHOLD_MS;
    if (now - lastMod <= threshold) continue;
    if (!agent.parentId && freshParentIds.has(agentId)) continue;
    stale.push(agentId);
  }
  return stale;
}

/**
 * Background `claude -p` / SDK runs invoked from a temp cwd land in
 * project dirs like `-private-tmp` or `-private-var-folders-...`. These
 * aren't interactive workspaces the user opened, just incidental noise.
 * Real workspaces never live under /tmp, /var/folders, or /var/tmp.
 */
const EPHEMERAL_PROJECT_RE = /^-(private-)?(tmp|var-folders|var-tmp)(-|$)/;

export function isEphemeralProjectDir(projectDir: string): boolean {
  return EPHEMERAL_PROJECT_RE.test(projectDir);
}

export async function discoverActiveSessions(projectsDir: string): Promise<void> {
  const settingsCache: SettingsCache = new Map();

  try {
    await fsp.access(projectsDir);
  } catch {
    return;
  }

  let topLevel: Dirent[];
  try {
    topLevel = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Classify directories straight from the readdir result. `Dirent.isDirectory()`
  // answers the directory question without a per-entry `fs.stat()` — the old
  // stat-per-entry pass dominated poll-loop CPU once the user had hundreds of
  // project dirs. (Session/project dirs are never symlinks, so not following
  // links here matches the previous behavior.)
  const projectDirs = topLevel
    .filter((d) => d.isDirectory() && !isEphemeralProjectDir(d.name))
    .map((d) => d.name);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }

    // ── Step 1: Discover main session agents ──────────
    const mainJsonlFiles = entries
      .filter((d) => {
        if (!d.name.endsWith(".jsonl")) return false;
        const sessionId = d.name.replace(".jsonl", "");
        return UUID_RE.test(sessionId);
      })
      .map((d) => d.name);

    for (const mainJsonl of mainJsonlFiles) {
      const sessionId = mainJsonl.replace(".jsonl", "");
      const filePath = path.join(projectPath, mainJsonl);

      let stat: Stats;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue;
      }
      const age = Date.now() - stat.mtimeMs;
      if (age > DISCOVERY_THRESHOLD_MS) continue;

      if (!agents.has(sessionId)) {
        const removedAt = removedAgentIds.get(sessionId);
        if (removedAt !== undefined && stat.mtimeMs <= removedAt) continue;
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
          effort: readEffortLevelCached(projectDir, settingsCache),
          is1MContext: readIs1MContextCached(projectDir, settingsCache),
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
    // Directory membership comes straight from the readdir Dirents. The old
    // stat-per-entry pass here was the single largest source of poll-loop
    // syscalls — it stat'd every historical JSONL file in the project just to
    // learn it wasn't a directory.
    const sessionDirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);

    for (const sessionId of sessionDirs) {
      const subagentsDir = path.join(projectPath, sessionId, "subagents");
      try {
        await fsp.access(subagentsDir);
      } catch {
        continue;
      }

      let files: string[];
      try {
        files = await fsp.readdir(subagentsDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(subagentsDir, jsonlFile);

        let stat: Stats;
        try {
          stat = await fsp.stat(filePath);
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
          let parentStat: Stats | undefined;
          try { parentStat = await fsp.stat(parentJsonl); } catch { /* missing */ }
          if (parentStat) {
            const removedAt = removedAgentIds.get(sessionId);
            // Don't resurrect a purged main unless its own JSONL (or the
            // triggering sub-agent file) has been written to after removal.
            if (
              removedAt !== undefined &&
              parentStat.mtimeMs <= removedAt &&
              stat.mtimeMs <= removedAt
            ) continue;
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
              effort: readEffortLevelCached(projectDir, settingsCache),
              is1MContext: readIs1MContextCached(projectDir, settingsCache),
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
        if (agentId.startsWith("mcp__")) continue;

        let agentType: ReturnType<typeof parseAgentType> = "generic";
        let displayType: string | undefined;
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
            if (typeof meta.agentType === "string" && meta.agentType.length > 0) {
              displayType = meta.agentType;
            }
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
          const removedAt = removedAgentIds.get(agentId);
          if (removedAt !== undefined && stat.mtimeMs <= removedAt) continue;
          removedAgentIds.delete(agentId);

          agentFilePaths.set(agentId, filePath);
          const info = extractTaskFromJSONL(filePath);
          const parentId = sessionId;

          registerAgent({
            agentId,
            sessionId,
            projectDir,
            agentType,
            displayType,
            parentId,
            task: description || info.task,
            slug: info.slug,
            model: info.model,
            startTime: info.startTime || stat.mtimeMs,
            teamId,
            teamName,
            effort: readEffortLevelCached(projectDir, settingsCache),
            is1MContext: readIs1MContextCached(projectDir, settingsCache),
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

  // Shared maintenance: dedup competing mains, purge stale agents, expire the
  // removed-id tombstones, and drop offsets for deleted files.
  pruneState();
}

/**
 * In-memory + bookkeeping maintenance shared by the full scan and the cheap
 * per-tick refresh: dedup competing mains, purge stale agents, expire the
 * removed-id tombstones, and clean up file offsets. Does no directory walking,
 * so it is safe (and cheap) to run on every poll.
 */
function pruneState(): void {
  // Dedup: when two or more main sessions share a projectDir, keep only the
  // most-recently-active one and cascade-purge the losers along with their
  // sub-agent descendants. Fires before stale-selection so the losing mains
  // never reach tier-1 completion — they disappear wholesale instead.
  const losingIds = selectLosingMains(agents, agentLastModified, Date.now());
  for (const agentId of losingIds) {
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
    if (agent?.teamId) {
      const team = teams.get(agent.teamId);
      if (team) {
        team.memberIds = team.memberIds.filter((id) => id !== agentId);
        if (team.memberIds.length === 0) {
          teams.delete(agent.teamId);
        }
      }
    }
    try {
      broadcast({ type: "state:remove", agentId });
    } catch (err) {
      console.warn(`Failed to broadcast dedup removal of ${agentId}:`, err);
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

/**
 * Cheap per-tick refresh that re-reads only the JSONL files of agents we are
 * already tracking — driving live token / tool-call / status updates without
 * the directory walk that stat()s every historical session file. New-session
 * discovery is handled separately on the slower full-scan cadence
 * (discoverActiveSessions). Runs the same maintenance pass at the end so
 * time-based idle/stale transitions still fire between full scans.
 */
export async function refreshTrackedAgents(): Promise<void> {
  // Snapshot first — pruneState() (and any mid-loop purge) mutates the map.
  const tracked = Array.from(agentFilePaths.entries());
  for (const [agentId, filePath] of tracked) {
    let stat: Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      // File vanished (session dir cleaned up). Leave eviction to the stale
      // purge / offset cleanup in pruneState().
      continue;
    }

    const newLines = readNewLines(filePath);
    for (const line of newLines) {
      try {
        // processEntry ignores its sessionId arg; pass agentId for both.
        processEntry(JSON.parse(line), agentId, agentId);
      } catch { /* skip malformed lines */ }
    }

    updateAgentStatus(agentId, stat.mtimeMs);
  }

  pruneState();
}
