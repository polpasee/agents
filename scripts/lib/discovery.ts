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
  reparentAgent,
  updateAgentStatus,
  processEntry,
  parseAgentType,
  harvestSpawnToolUses,
  resolveSpawnOwner,
  resolveLiveSpawner,
  dropSpawnEntriesFor,
  pendingReparents,
  broadcast,
  broadcastRegisterFor,
  workflows,
  upsertWorkflow,
  removeWorkflow,
} from "./agent-state";
import {
  readNewLines,
  extractTaskFromJSONL,
  cleanupFileOffsets,
} from "./file-reader";
import {
  THINKING_EFFORTS,
  type ThinkingEffort,
  type WorkflowRunState,
} from "../../src/lib/types";
import {
  DISCOVERY_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  SUBAGENT_STALE_THRESHOLD_MS,
  REMOVED_IDS_TTL_MS,
  STATUS_RUNNING_THRESHOLD_MS,
} from "./config";
import { scanWorkflows, scanWorkflowScripts } from "./workflow-scan";

// ---------------------------------------------------------------------------
// Per-pass settings.json cache — avoids re-reading the same file for every
// agent registered during a single discovery run.
// ---------------------------------------------------------------------------

type ParsedSettings = Record<string, unknown> | null;
type SettingsCache = Map<string, ParsedSettings>;

function readSettingsCached(
  filePath: string,
  cache: SettingsCache,
): ParsedSettings {
  if (cache.has(filePath)) return cache.get(filePath)!;
  let result: ParsedSettings = null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    result =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
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

function readEffortLevelCached(
  projectDir: string,
  cache: SettingsCache,
): ThinkingEffort | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const value = parsed?.effortLevel;
    if (
      typeof value === "string" &&
      (THINKING_EFFORTS as readonly string[]).includes(value)
    ) {
      return value as ThinkingEffort;
    }
  }
  return undefined;
}

function readIs1MContextCached(
  projectDir: string,
  cache: SettingsCache,
): boolean | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const model = parsed?.model;
    if (typeof model === "string") return /\[1m\]/i.test(model);
  }
  return undefined;
}

/**
 * Main-session registration shared by Step 1 discovery and the Phase B
 * parent backfill: clears the tombstone, records the file path, and
 * registers the session as a "main" agent. The tombstone gates differ per
 * call site and stay with the callers.
 */
function registerMainAgent(opts: {
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

// Content-hash cache: avoids re-broadcasting workflow runs that haven't changed.
const wfContentCache = new Map<string, string>();

// Per-file mtime cache: skips reading wf files that haven't changed on disk.
const wfMtimeCache = new Map<string, number>();

/**
 * Returns the runIds of workflow runs belonging to the given session.
 * Exported for testing.
 */
export function workflowRunIdsForSession(
  workflows: Map<string, WorkflowRunState>,
  sessionId: string,
): string[] {
  const ids: string[] = [];
  for (const [runId, run] of workflows)
    if (run.sessionId === sessionId) ids.push(runId);
  return ids;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  agents: Map<
    string,
    { parentId?: string; startTime: number; metadata?: Record<string, unknown> }
  >,
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
      // safe: i starts at 1 and stays < length, so mainIds[i] exists
      const id = mainIds[i]!;
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
  // A fresh or actively-working child shields its WHOLE ancestor chain, not
  // just its direct parent: a nested spawner blocked on the Agent tool goes
  // silent for the entire child run, and purging it would orphan every
  // descendant (and erase the spawn-index entries needed to re-anchor them).
  const freshParentIds = new Set<string>();
  for (const [childId, child] of agents) {
    if (!child.parentId) continue;
    const childLastMod = agentLastModified.get(childId) || child.startTime;
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
      cursorId = agents.get(cursorId)?.parentId;
    }
  }
  const stale: string[] = [];
  for (const [agentId, agent] of agents) {
    if (agent.status !== "running" && agent.status !== "idle") continue;
    const lastMod = agentLastModified.get(agentId) || agent.startTime;
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
 * Phase-A buffer for one fresh sub-agent JSONL: stat + parsed lines read
 * exactly once per tick, registered/processed in Phase B after the spawn
 * index has been harvested. Meta fields are filled at the start of Phase B.
 */
interface BufferedSubagentFile {
  filePath: string;
  /** Directory holding the transcript and its meta.json (flat or run dir). */
  dir: string;
  stat: Stats;
  parsed: Record<string, unknown>[];
  agentId?: string;
  agentType: ReturnType<typeof parseAgentType>;
  displayType?: string;
  description: string;
  teamId?: string;
  teamName?: string;
  toolUseId?: string;
}

/**
 * Children registered against the sessionId fallback whose meta carried a
 * toolUseId the spawn index could not resolve yet (the spawner's JSONL line
 * was not flushed when its file was read). Retried after every scan; entries
 * drop on resolution or when the agent is purged. Lives in the HMR-safe
 * singleton next to spawnIndex; re-exported here for testing.
 */
export { pendingReparents };

/**
 * Late parent resolution: if the spawn index now knows a pending child's
 * spawner and that spawner is a live agent, swap the child onto it.
 */
function retryPendingReparents(): void {
  for (const [agentId, toolUseId] of pendingReparents) {
    const agent = agents.get(agentId);
    if (!agent) {
      pendingReparents.delete(agentId);
      continue;
    }
    const owner = resolveLiveSpawner(toolUseId, agentId);
    if (owner === undefined) continue;
    if (owner !== agent.parentId) reparentAgent(agentId, owner);
    pendingReparents.delete(agentId);
  }
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

// compact-/mcp__ transcripts are tool noise, never real sub-agents. The Phase A
// read gate, the Phase B meta-read gate, and the Phase B registration skip must
// all agree on this predicate for the read-gating/tombstone semantics to hold
// (see the gating comment in Phase A).
function isIgnoredSubagentId(agentId: string): boolean {
  return agentId.startsWith("compact-") || agentId.startsWith("mcp__");
}

export async function discoverActiveSessions(
  projectsDir: string,
): Promise<void> {
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
      } catch {
        continue;
      }

      let files: string[];
      try {
        files = await fsp.readdir(subagentsDir);
      } catch {
        continue;
      }

      let workflowScriptNames = new Map<string, string>();

      // Candidates carry their directory: Task/Agent sub-agents sit flat in
      // subagents/, Workflow-tool sub-agents one level deeper at
      // subagents/workflows/<runId>/. The descent is fixed at those two
      // levels — a deeper workflows/<runId>/sub/ layout would NOT be picked
      // up — so unknown future layouts stay un-ingested and the
      // stat-per-entry hazard above doesn't come back. (subagents/workflows/
      // holds transcripts; despite the shared leaf name it is a different
      // directory from <session>/workflows/, the wf_*.json run state read by
      // workflow-scan.ts.)
      const listings: Array<{ dir: string; names: string[] }> = [
        { dir: subagentsDir, names: files },
      ];

      if (files.includes("workflows")) {
        workflowScriptNames = await scanWorkflowScripts(projectPath, sessionId);
        const workflowsDir = path.join(subagentsDir, "workflows");
        // At both descent levels: ENOENT/ENOTDIR are routine races (run
        // cleanup between readdirs) and skip silently; anything else
        // persisting would silently re-lose workflow agents — the exact bug
        // this descent exists to fix — so it leaves a breadcrumb.
        let runEntries: Dirent[] = [];
        try {
          runEntries = await fsp.readdir(workflowsDir, { withFileTypes: true });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTDIR") {
            console.warn(`Failed to read workflows dir ${workflowsDir}:`, err);
          }
        }
        for (const runEntry of runEntries) {
          if (!runEntry.isDirectory()) continue;
          const runDir = path.join(workflowsDir, runEntry.name);
          try {
            listings.push({ dir: runDir, names: await fsp.readdir(runDir) });
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "ENOTDIR") {
              console.warn(`Failed to read workflow run dir ${runDir}:`, err);
            }
          }
        }
      }

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
      const buffered: BufferedSubagentFile[] = [];
      for (const { dir, name } of candidates) {
        const filePath = path.join(dir, name);

        let stat: Stats;
        try {
          stat = await fsp.stat(filePath);
        } catch {
          continue;
        }
        const age = Date.now() - stat.mtimeMs;
        if (age > DISCOVERY_THRESHOLD_MS) continue;

        const agentIdMatch = name.match(/^agent-(.+)\.jsonl$/);
        const agentId = agentIdMatch ? agentIdMatch[1] : undefined;

        // Gate reads exactly like the old single-pass loop: compact-/mcp__/
        // non-agent transcripts are never opened (their replayed content must
        // not reach the spawn index), and a tombstoned agent's backlog stays
        // unread — offsets only advance for lines Phase B will process, so
        // the backlog replays if the agent resurrects. The file is still
        // buffered: its stat drives session backfill/freshness in Phase B,
        // which always ran before these gates.
        const parsed: Record<string, unknown>[] = [];
        if (agentId !== undefined && !isIgnoredSubagentId(agentId)) {
          const removedAt = removedAgentIds.get(agentId);
          if (removedAt === undefined || stat.mtimeMs > removedAt) {
            for (const line of readNewLines(filePath)) {
              try {
                parsed.push(JSON.parse(line));
              } catch {
                /* skip */
              }
            }
            for (const entry of parsed) harvestSpawnToolUses(entry, agentId);
          }
        }

        buffered.push({
          filePath,
          dir,
          stat,
          parsed,
          agentId,
          agentType: "generic",
          description: "",
        });
      }

      // ── Phase B: register + process ────────────────
      // Pre-read meta.json (type/team/toolUseId) so parent resolution can
      // order registrations parent-before-child within this batch.
      for (const file of buffered) {
        const { agentId } = file;
        if (!agentId || isIgnoredSubagentId(agentId)) continue;
        // Resolve the meta against the transcript's own directory — an agent
        // in a run dir keeps its meta.json beside it, not in subagents/.
        const metaPath = path.join(file.dir, `agent-${agentId}.meta.json`);
        if (!metaPaths.has(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          file.agentType = parseAgentType(meta.agentType);
          if (typeof meta.agentType === "string" && meta.agentType.length > 0) {
            file.displayType = meta.agentType;
          }
          file.description = meta.description || "";
          file.teamId = meta.teamId;
          file.teamName = meta.teamName;
          if (typeof meta.toolUseId === "string" && meta.toolUseId.length > 0) {
            file.toolUseId = meta.toolUseId;
          }
        } catch (err) {
          console.warn(`Failed to read meta file ${metaPath}:`, err);
        }
      }

      // Dependency sort: an agent spawned by another agent in this batch must
      // register after its spawner, so the frontend never sees a child before
      // its anchor. Depth is capped at 5 (Claude Code's nesting limit), which
      // also bounds any cycle from corrupt data.
      const batchIds = new Set<string>();
      for (const file of buffered) {
        if (file.agentId) batchIds.add(file.agentId);
      }
      const batchParent = new Map<string, string>();
      for (const file of buffered) {
        if (!file.agentId || !file.toolUseId) continue;
        const owner = resolveLiveSpawner(file.toolUseId, file.agentId, (id) =>
          batchIds.has(id),
        );
        if (owner !== undefined) {
          batchParent.set(file.agentId, owner);
        }
      }
      const spawnDepth = (agentId?: string): number => {
        if (!agentId) return 0;
        let depth = 0;
        let cur = batchParent.get(agentId);
        while (cur !== undefined && depth < 5) {
          depth++;
          cur = batchParent.get(cur);
        }
        return depth;
      };
      buffered.sort((a, b) => spawnDepth(a.agentId) - spawnDepth(b.agentId));

      for (const file of buffered) {
        const { filePath, stat } = file;

        // Backfill the parent session if it hasn't been discovered yet —
        // the main's JSONL may be older than DISCOVERY_THRESHOLD_MS while
        // Claude is waiting on a long background tool, but the session is
        // clearly alive because this sub-agent is writing. Without this,
        // the sub-agent would render orphaned (no MAIN anchor).
        if (!agents.has(sessionId)) {
          const parentJsonl = path.join(projectPath, `${sessionId}.jsonl`);
          let parentStat: Stats | undefined;
          try {
            parentStat = await fsp.stat(parentJsonl);
          } catch {
            /* missing */
          }
          if (parentStat) {
            const removedAt = removedAgentIds.get(sessionId);
            // Don't resurrect a purged main unless its own JSONL (or the
            // triggering sub-agent file) has been written to after removal.
            if (
              removedAt !== undefined &&
              parentStat.mtimeMs <= removedAt &&
              stat.mtimeMs <= removedAt
            )
              continue;
            registerMainAgent({
              sessionId,
              filePath: parentJsonl,
              projectDir,
              fallbackStartMs: parentStat.mtimeMs,
              settingsCache,
            });
            // Seed lastModified from the fresher of parent mtime or child mtime
            // so the main stays marked alive while the sub is active.
            updateAgentStatus(
              sessionId,
              Math.max(parentStat.mtimeMs, stat.mtimeMs),
            );
          }
        } else {
          // Keep an already-registered parent fresh whenever a child writes,
          // so the stale-purge selector doesn't target the main mid-work.
          updateAgentStatus(sessionId, stat.mtimeMs);
        }

        if (!file.agentId) continue;
        const agentId = file.agentId;

        if (isIgnoredSubagentId(agentId)) continue;

        let agentType = file.agentType;
        // If no meta file, try to infer type from description
        if (agentType === "generic" && file.description) {
          agentType = parseAgentType(file.description);
        }

        if (!agents.has(agentId)) {
          const removedAt = removedAgentIds.get(agentId);
          if (removedAt !== undefined && stat.mtimeMs <= removedAt) continue;
          removedAgentIds.delete(agentId);

          agentFilePaths.set(agentId, filePath);
          const info = extractTaskFromJSONL(filePath);
          // Resolve the real spawner from the spawn index — a nested
          // sub-agent's meta.toolUseId points at the Agent/Task tool_use in
          // its spawner's JSONL. Fall back to the session when the id is
          // unresolved (or the owner isn't registered) and queue a retry.
          let parentId = sessionId;
          if (file.toolUseId !== undefined) {
            const owner = resolveLiveSpawner(file.toolUseId, agentId);
            if (owner !== undefined) {
              parentId = owner;
            } else if (resolveSpawnOwner(file.toolUseId) !== agentId) {
              // Queue a retry unless the id (corruptly) points at the agent
              // itself — that could never resolve to a usable parent.
              pendingReparents.set(agentId, file.toolUseId);
            }
          }

          const workflowName =
            path.basename(path.dirname(file.dir)) === "workflows"
              ? workflowScriptNames.get(path.basename(file.dir))
              : undefined;
          registerAgent({
            agentId,
            sessionId,
            projectDir,
            agentType,
            displayType: file.displayType,
            parentId,
            task: file.description || info.task,
            slug: info.slug,
            model: info.model,
            startTime: info.startTime || stat.mtimeMs,
            teamId: file.teamId,
            teamName: file.teamName,
            effort: readEffortLevelCached(projectDir, settingsCache),
            is1MContext: readIs1MContextCached(projectDir, settingsCache),
            workflowName,
          });
        } else {
          const existing = agents.get(agentId);

          if (file.toolUseId !== undefined && !pendingReparents.has(agentId)) {
            // Heal the late-meta race: a child whose meta.json appeared a tick
            // after its JSONL registered on the session fallback with no retry
            // queued. Queue one now that the toolUseId is visible; the retry
            // after Step 2 applies it once the spawner is live.
            if (existing && existing.parentId === sessionId) {
              const owner = resolveSpawnOwner(file.toolUseId);
              if (owner !== agentId && owner !== sessionId) {
                pendingReparents.set(agentId, file.toolUseId);
              }
            }
          }

          // Same race, type/description side: workflow metas carry no
          // toolUseId, so the branch above never fires for them and a child
          // registered before its meta flushed would stay "generic" forever.
          // Fill only fields still at their no-meta defaults, and only when
          // the value actually changes — an unchanged meta must not
          // re-broadcast every pass. Healed fields go out through the shared
          // mid-session register re-broadcast (same path as re-parents).
          if (existing) {
            let healed = false;
            if (
              existing.displayType === undefined &&
              file.displayType !== undefined
            ) {
              existing.displayType = file.displayType;
              healed = true;
            }
            if (existing.agentType === "generic" && agentType !== "generic") {
              existing.agentType = agentType;
              healed = true;
            }
            if (
              file.description &&
              file.description !== existing.task &&
              (!existing.task || existing.task === "Session")
            ) {
              existing.task = file.description;
              healed = true;
            }
            if (healed) {
              broadcastRegisterFor(existing, Date.now());
            }
          }
        }

        for (const entry of file.parsed) {
          processEntry(entry, agentId);
        }

        updateAgentStatus(agentId, stat.mtimeMs);
      }
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
 * Complete per-agent purge shared by both eviction loops in pruneState():
 * drops the agent from every tracking map and the spawn-index / pending-
 * reparent bookkeeping, tombstones its id, splices its edges, removes it
 * from its team, broadcasts the removal to viewers (warn wording set by
 * warnLabel), and tears down workflow runs for parentless mains.
 */
function purgeAgent(agentId: string, warnLabel: string): void {
  const agent = agents.get(agentId);
  agents.delete(agentId);
  agentLastModified.delete(agentId);
  agentFilePaths.delete(agentId);
  dropSpawnEntriesFor(agentId);
  pendingReparents.delete(agentId);
  removedAgentIds.set(agentId, Date.now());
  for (let i = edges.length - 1; i >= 0; i--) {
    // safe: i is in [0, edges.length) by loop bounds
    const edge = edges[i]!;
    if (edge.source === agentId || edge.target === agentId) {
      edges.splice(i, 1);
    }
  }
  // Remove agent from its team; delete team if empty
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
    console.warn(`Failed to broadcast ${warnLabel} of ${agentId}:`, err);
  }
  if (agent && !agent.parentId) {
    for (const runId of workflowRunIdsForSession(workflows, agentId)) {
      wfContentCache.delete(runId);
      removeWorkflow(runId);
    }
  }
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
    purgeAgent(agentId, "dedup removal");
  }

  const staleIds = selectStaleAgentIds(agents, agentLastModified, Date.now());
  for (const agentId of staleIds) {
    purgeAgent(agentId, "removal");
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
        processEntry(JSON.parse(line), agentId);
      } catch {
        /* skip malformed lines */
      }
    }

    updateAgentStatus(agentId, stat.mtimeMs);
  }

  pruneState();
}
