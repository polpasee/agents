import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Dirent, Stats } from "node:fs";
import {
  agents,
  removedAgentIds,
  agentFilePaths,
  registerAgent,
  updateAgentStatus,
  processEntry,
  upsertWorkflow,
  workflows,
} from "./agent-state";
import { extractTaskFromJSONL, readNewLines } from "./file-reader";
import type { WorkflowRunState } from "../../src/lib/types";
import {
  DISCOVERY_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  SUBAGENT_STALE_THRESHOLD_MS,
  STATUS_RUNNING_THRESHOLD_MS,
} from "./config";
import { scanWorkflows } from "./workflow-scan";
import {
  type SettingsCache,
  readEffortLevelCached,
  readIs1MContextCached,
} from "./settings-cache";

// Content-hash cache: avoids re-broadcasting workflow runs that haven't changed.
export const wfContentCache = new Map<string, string>();

// Per-file mtime cache: skips reading wf files that haven't changed on disk.
export const wfMtimeCache = new Map<string, number>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Returns the runIds of workflow runs belonging to the given session.
 * Exported for testing.
 */
export function workflowRunIdsForSession(
  wfMap: Map<string, WorkflowRunState>,
  sessionId: string,
): string[] {
  const ids: string[] = [];
  for (const [runId, run] of wfMap)
    if (run.sessionId === sessionId) ids.push(runId);
  return ids;
}

/**
 * Main-session registration shared by Step 1 discovery and the Phase B
 * parent backfill: clears the tombstone, records the file path, and
 * registers the session as a "main" agent. The tombstone gates differ per
 * call site and stay with the callers.
 */
export function registerMainAgent(opts: {
  sessionId: string;
  filePath: string;
  projectDir: string;
  fallbackStartMs: number;
  settingsCache: SettingsCache;
}): void {
  removedAgentIds.delete(opts.sessionId);
  const info = extractTaskFromJSONL(opts.filePath);
  agentFilePaths.set(opts.sessionId, opts.filePath);
  registerAgent({
    agentId: opts.sessionId,
    sessionId: opts.sessionId,
    projectDir: opts.projectDir,
    agentType: "main",
    task: info.task,
    slug: info.slug,
    model: info.model,
    startTime: info.startTime || opts.fallbackStartMs,
    effort: readEffortLevelCached(opts.projectDir, opts.settingsCache),
    is1MContext: readIs1MContextCached(opts.projectDir, opts.settingsCache),
  });
}

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
  agentsMap: Map<
    string,
    {
      parentId?: string | undefined;
      startTime: number;
      metadata?: Record<string, unknown> | undefined;
    }
  >,
  agentLastModifiedMap: Map<string, number>,
  now: number,
): string[] {
  // Group main agents (no parentId) by projectDir.
  const mainsByProject = new Map<string, string[]>();
  for (const [id, agent] of agentsMap) {
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
      const aAgent = agentsMap.get(a);
      const bAgent = agentsMap.get(b);
      const aMod = agentLastModifiedMap.get(a) ?? aAgent?.startTime ?? 0;
      const bMod = agentLastModifiedMap.get(b) ?? bAgent?.startTime ?? 0;
      if (bMod !== aMod) return bMod - aMod;
      const aStart = aAgent?.startTime ?? 0;
      const bStart = bAgent?.startTime ?? 0;
      if (bStart !== aStart) return bStart - aStart;
      return b.localeCompare(a);
    });
    // Keep mainIds[0] (winner). Evict only losers whose JSONL has gone quiet
    // — a still-writing loser is a real concurrent session, not a ghost.
    for (let i = 1; i < mainIds.length; i++) {
      // safe: i starts at 1 and stays < length, so mainIds[i] exists
      const id = mainIds[i]!;
      const mtime =
        agentLastModifiedMap.get(id) ?? agentsMap.get(id)?.startTime ?? 0;
      if (now - mtime <= STATUS_RUNNING_THRESHOLD_MS) continue;
      losingMainIds.push(id);
    }
  }

  if (losingMainIds.length === 0) return [];

  // Walk descendants iteratively for each losing main. We rebuild the
  // parent→children map once so the outer loop stays O(N) regardless of
  // how many mains lose.
  const childrenByParent = new Map<string, string[]>();
  for (const [id, agent] of agentsMap) {
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
  agentsMap: Map<
    string,
    { parentId?: string | undefined; status: string; startTime: number }
  >,
  agentLastModifiedMap: Map<string, number>,
  now: number,
): string[] {
  // A fresh or actively-working child shields its WHOLE ancestor chain, not
  // just its direct parent: a nested spawner blocked on the Agent tool goes
  // silent for the entire child run, and purging it would orphan every
  // descendant (and erase the spawn-index entries needed to re-anchor them).
  const freshParentIds = new Set<string>();
  for (const [childId, child] of agentsMap) {
    if (!child.parentId) continue;
    const childLastMod = agentLastModifiedMap.get(childId) || child.startTime;
    const shields =
      now - childLastMod <= STALE_THRESHOLD_MS ||
      child.status === "running" ||
      child.status === "waiting";
    if (!shields) continue;
    let cursorId: string | undefined = child.parentId;
    const seen = new Set<string>([childId]);
    while (cursorId !== undefined && !seen.has(cursorId)) {
      freshParentIds.add(cursorId);
      seen.add(cursorId);
      cursorId = agentsMap.get(cursorId)?.parentId;
    }
  }
  const stale: string[] = [];
  for (const [agentId, agent] of agentsMap) {
    if (agent.status !== "running" && agent.status !== "idle") continue;
    const lastMod = agentLastModifiedMap.get(agentId) || agent.startTime;
    const threshold = agent.parentId
      ? SUBAGENT_STALE_THRESHOLD_MS
      : STALE_THRESHOLD_MS;
    if (now - lastMod <= threshold) continue;
    if (freshParentIds.has(agentId)) continue;
    stale.push(agentId);
  }
  return stale;
}

/**
 * Step 1: Discover main session agents for one project directory.
 * Registers fresh main JSONLs, reads new lines, updates status, and
 * scans workflow runs (Step 1.5). Operates on module-global maps.
 */
export async function discoverMainSessions(
  projectPath: string,
  projectDir: string,
  entries: Dirent[],
  settingsCache: SettingsCache,
): Promise<void> {
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
      registerMainAgent({
        sessionId,
        filePath,
        projectDir,
        fallbackStartMs: stat.mtimeMs,
        settingsCache,
      });
    }

    const newLines = readNewLines(filePath);
    for (const line of newLines) {
      try {
        const entry = JSON.parse(line);
        processEntry(entry, sessionId);
      } catch {
        /* skip */
      }
    }

    updateAgentStatus(sessionId, stat.mtimeMs);

    // ── Step 1.5: Discover workflow runs for this session ──
    {
      const runs = await scanWorkflows(projectPath, sessionId, wfMtimeCache);
      for (const run of runs) {
        const hash = JSON.stringify(run);
        if (wfContentCache.get(run.runId) !== hash) {
          wfContentCache.set(run.runId, hash);
          upsertWorkflow(run);
        }
      }
    }
  }
}

// Re-export workflows map reference for use by pruning module
export { workflows };
