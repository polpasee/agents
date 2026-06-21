import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Stats } from "node:fs";
import {
  agents,
  removedAgentIds,
  agentFilePaths,
  registerAgent,
  updateAgentStatus,
  processEntry,
  parseAgentType,
  harvestSpawnToolUses,
  resolveSpawnOwner,
  resolveLiveSpawner,
  pendingReparents,
  broadcastRegisterFor,
  reparentAgent,
} from "./agent-state";

// Re-exported so discovery.ts (and tests) can access pendingReparents through
// the subagent-pipeline barrel without reaching into agent-state directly.
export { pendingReparents } from "./agent-state";
import { extractTaskFromJSONL, readNewLines } from "./file-reader";
import { DISCOVERY_THRESHOLD_MS } from "./config";
import { scanWorkflowScripts } from "./workflow-scan";
import {
  type SettingsCache,
  readEffortLevelCached,
  readIs1MContextCached,
} from "./settings-cache";
import { registerMainAgent } from "./main-session-discovery";

/**
 * Phase-A buffer for one fresh sub-agent JSONL: stat + parsed lines read
 * exactly once per tick, registered/processed in Phase B after the spawn
 * index has been harvested. Meta fields are filled at the start of Phase B.
 */
export interface BufferedSubagentFile {
  filePath: string;
  /** Directory holding the transcript and its meta.json (flat or run dir). */
  dir: string;
  stat: Stats;
  parsed: Record<string, unknown>[];
  agentId?: string | undefined;
  agentType: ReturnType<typeof parseAgentType>;
  displayType?: string | undefined;
  description: string;
  teamId?: string | undefined;
  teamName?: string | undefined;
  toolUseId?: string | undefined;
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

/**
 * Late parent resolution: if the spawn index now knows a pending child's
 * spawner and that spawner is a live agent, swap the child onto it.
 */
export function retryPendingReparents(): void {
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
 * Step 2 setup: build the two-level listings array (flat subagents/ plus
 * one-level-deep subagents/workflows/<runId>/ run dirs) for one session.
 * Also returns the workflow-script name map populated by scanWorkflowScripts.
 */
export async function buildSubagentListings(
  projectPath: string,
  sessionId: string,
  files: string[],
): Promise<{
  listings: Array<{ dir: string; names: string[] }>;
  workflowScriptNames: Map<string, string>;
}> {
  const subagentsDir = path.join(projectPath, sessionId, "subagents");
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
    let runEntries: import("node:fs").Dirent[] = [];
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

  return { listings, workflowScriptNames };
}

/**
 * Phase A: stat and read each fresh JSONL exactly once, buffering parsed
 * entries for Phase B. Harvesting Agent/Task spawn tool_use ids up front
 * makes the spawn index complete before any registration below resolves
 * parents — readdir can list a child before its spawner.
 */
export async function bufferSubagentFiles(
  candidates: Array<{ dir: string; name: string }>,
): Promise<BufferedSubagentFile[]> {
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

  return buffered;
}

/**
 * Phase B meta pre-read: fills agentType, displayType, description, teamId,
 * teamName, and toolUseId onto each buffered file from its meta.json.
 * Operates in-place on the buffered array.
 */
export function readSubagentMeta(
  buffered: BufferedSubagentFile[],
  metaPaths: Set<string>,
): void {
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
}

/**
 * Dependency sort: an agent spawned by another agent in this batch must
 * register after its spawner, so the frontend never sees a child before
 * its anchor. Depth is capped at 5 (Claude Code's nesting limit), which
 * also bounds any cycle from corrupt data.
 * Sorts buffered in-place by spawn depth (parent-before-child order).
 */
export function dependencySortBuffered(buffered: BufferedSubagentFile[]): void {
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
}

/**
 * Phase B body: for each buffered sub-agent file, backfill the parent
 * session if missing, then register-or-heal the sub-agent, then process
 * its buffered entries. Operates on module-global maps.
 */
export async function processBufferedSubagents(
  buffered: BufferedSubagentFile[],
  sessionId: string,
  projectPath: string,
  projectDir: string,
  workflowScriptNames: Map<string, string>,
  settingsCache: SettingsCache,
): Promise<void> {
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
