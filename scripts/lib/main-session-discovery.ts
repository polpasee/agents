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
} from "./agent-state";
import { extractTaskFromJSONL, readNewLines } from "./file-reader";
import type { WorkflowRunState } from "../../src/lib/types";
import { DISCOVERY_THRESHOLD_MS } from "./config";
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

// Duplicated from subagent-pipeline.ts's isEphemeralProjectDir rather than
// imported: subagent-pipeline.ts already imports registerMainAgent from this
// file, so importing back would create a module cycle.
const EPHEMERAL_PROJECT_RE = /^-(private-)?(tmp|var-folders|var-tmp)(-|$)/;

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
  }
}

/** Scan and broadcast workflow-run changes for one session, deduping via the
 *  module-level content-hash cache. Shared by the (now-removed) inline
 *  discovery step and `scanWorkflowsAllSessions` below. */
async function scanAndUpsertWorkflows(
  projectPath: string,
  sessionId: string,
): Promise<void> {
  const runs = await scanWorkflows(projectPath, sessionId, wfMtimeCache);
  for (const run of runs) {
    const hash = JSON.stringify(run);
    if (wfContentCache.get(run.runId) !== hash) {
      wfContentCache.set(run.runId, hash);
      upsertWorkflow(run);
    }
  }
}

/**
 * Independent, registration-free workflow scan across every project/session
 * dir under `projectsDir`. Extracted so workflow grouping (a file-poll
 * residual kept after the push-ingestion switch) no longer requires running
 * full main-session discovery (registration, JSONL tailing, status updates).
 */
export async function scanWorkflowsAllSessions(
  projectsDir: string,
): Promise<void> {
  let topLevel: Dirent[];
  try {
    topLevel = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }

  const projectDirs = topLevel
    .filter((d) => d.isDirectory() && !EPHEMERAL_PROJECT_RE.test(d.name))
    .map((d) => d.name);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const sessionFiles = entries
      .filter((d) => {
        if (!d.name.endsWith(".jsonl")) return false;
        return UUID_RE.test(d.name.replace(".jsonl", ""));
      })
      .map((d) => d.name);

    const now = Date.now();
    for (const fileName of sessionFiles) {
      // Freshness gate (mirrors discoverMainSessions): only sessions touched
      // within DISCOVERY_THRESHOLD_MS can have live workflow changes, so skip
      // the per-session subagents/workflows dir walk for stale sessions instead
      // of scanning every historical session every poll tick.
      let stat: Stats;
      try {
        stat = await fsp.stat(path.join(projectPath, fileName));
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > DISCOVERY_THRESHOLD_MS) continue;
      await scanAndUpsertWorkflows(projectPath, fileName.replace(".jsonl", ""));
    }
  }
}
