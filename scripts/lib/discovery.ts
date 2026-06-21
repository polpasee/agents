import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Dirent, Stats } from "node:fs";
import { agentFilePaths, updateAgentStatus, processEntry } from "./agent-state";
import { readNewLines } from "./file-reader";
import { discoverMainSessions } from "./main-session-discovery";
import {
  isEphemeralProjectDir,
  retryPendingReparents,
  buildSubagentListings,
  bufferSubagentFiles,
  readSubagentMeta,
  dependencySortBuffered,
  processBufferedSubagents,
} from "./subagent-pipeline";
import { pruneState } from "./pruning";
import type { SettingsCache } from "./settings-cache";

// ---------------------------------------------------------------------------
// Re-exports for importers (background-tasks.ts via dynamic import, tests).
// ---------------------------------------------------------------------------

export {
  workflowRunIdsForSession,
  selectLosingMains,
  selectStaleAgentIds,
} from "./main-session-discovery";
export { isEphemeralProjectDir, pendingReparents } from "./subagent-pipeline";

// Re-export pendingReparents from agent-state via subagent-pipeline is already
// handled above. The original file also re-exported pendingReparents from
// agent-state directly — subagent-pipeline now re-exports it from agent-state,
// so the chain is: agent-state → subagent-pipeline → discovery.

export async function discoverActiveSessions(
  projectsDir: string,
): Promise<void> {
  const settingsCache: SettingsCache = new Map();

  try {
    await fsp.access(projectsDir);
  } catch (err) {
    // A missing projects root (ENOENT) is normal before Claude Code has ever
    // run; bail silently. An unexpected code (EACCES, …) means the root exists
    // but we can't reach it — surface it before bailing.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.warn(`Failed to access projects dir ${projectsDir}:`, err);
    }
    return;
  }

  let topLevel: Dirent[];
  try {
    topLevel = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    // access() just succeeded, so ENOENT/ENOTDIR here is a teardown race and
    // skips silently; any other code (EACCES, EMFILE, …) blanks the entire
    // topology and deserves a breadcrumb.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.warn(`Failed to read projects dir ${projectsDir}:`, err);
    }
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
    } catch (err) {
      // ENOENT/ENOTDIR are routine (a project dir can vanish or be replaced
      // mid-scan); skip silently. An unexpected code (EACCES, EMFILE, …) is a
      // real signal — permission/fd trouble that would otherwise hide every
      // session in this project — so leave a breadcrumb before skipping.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        console.warn(`Failed to read project dir ${projectPath}:`, err);
      }
      continue;
    }

    // ── Step 1: Discover main session agents ──────────
    await discoverMainSessions(projectPath, projectDir, entries, settingsCache);

    // ── Step 2: Discover sub-agents ──────────────────
    // Directory membership comes straight from the readdir Dirents. The old
    // stat-per-entry pass here was the single largest source of poll-loop
    // syscalls — it stat'd every historical JSONL file in the project just to
    // learn it wasn't a directory.
    const sessionDirs = entries
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const sessionId of sessionDirs) {
      const subagentsDir = path.join(projectPath, sessionId, "subagents");
      try {
        await fsp.access(subagentsDir);
      } catch (err) {
        // A session without a subagents/ dir is the common case (ENOENT), and
        // a session dir can vanish mid-scan (ENOTDIR); both are normal and
        // skip silently. An unexpected code (EACCES, …) means we can't tell
        // whether sub-agents exist — surface it.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
          console.warn(`Failed to access subagents dir ${subagentsDir}:`, err);
        }
        continue;
      }

      let files: string[];
      try {
        files = await fsp.readdir(subagentsDir);
      } catch (err) {
        // Same race window as above (the dir passed access() then vanished):
        // ENOENT/ENOTDIR are routine and skip silently; an unexpected code
        // (EMFILE/ENFILE fd-exhaustion, EACCES) would silently drop every
        // sub-agent in this session, so leave a breadcrumb.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
          console.warn(`Failed to read subagents dir ${subagentsDir}:`, err);
        }
        continue;
      }

      const { listings, workflowScriptNames } = await buildSubagentListings(
        projectPath,
        sessionId,
        files,
      );

      const candidates: Array<{ dir: string; name: string }> = [];
      const metaPaths = new Set<string>();
      for (const { dir, names } of listings) {
        for (const name of names) {
          if (name.endsWith(".jsonl")) candidates.push({ dir, name });
          else if (name.endsWith(".meta.json"))
            metaPaths.add(path.join(dir, name));
        }
      }

      // ── Phase A: read + harvest ────────────────────
      // Stat and read each fresh JSONL exactly once, buffering parsed entries
      // for Phase B. Harvesting Agent/Task spawn tool_use ids up front makes
      // the spawn index complete before any registration below resolves
      // parents — readdir can list a child before its spawner.
      const buffered = await bufferSubagentFiles(candidates);

      // ── Phase B: register + process ────────────────
      // Pre-read meta.json (type/team/toolUseId) so parent resolution can
      // order registrations parent-before-child within this batch.
      readSubagentMeta(buffered, metaPaths);

      dependencySortBuffered(buffered);

      await processBufferedSubagents(
        buffered,
        sessionId,
        projectPath,
        projectDir,
        workflowScriptNames,
        settingsCache,
      );
    }
  }

  // Late parent resolution for children registered against the session
  // fallback this tick or earlier whose spawner's tool_use line has landed.
  retryPendingReparents();

  // Shared maintenance: dedup competing mains, purge stale agents, expire the
  // removed-id tombstones, and drop offsets for deleted files.
  pruneState();
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
        processEntry(JSON.parse(line), agentId);
      } catch {
        /* skip malformed lines */
      }
    }

    updateAgentStatus(agentId, stat.mtimeMs);
  }

  pruneState();
}
