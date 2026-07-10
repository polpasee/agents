import {
  agents,
  agentLastModified,
  agentFilePaths,
  removedAgentIds,
  edges,
  teams,
  broadcast,
  dropSpawnEntriesFor,
  pendingReparents,
  workflows,
  removeWorkflow,
} from "./agent-state";
import { cleanupFileOffsets } from "./file-reader";
import {
  REMOVED_IDS_TTL_MS,
  STATUS_RUNNING_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  SUBAGENT_STALE_THRESHOLD_MS,
  EXTERNAL_AGENT_ID_PREFIX,
  MAX_EXTERNAL_RUN_MS,
} from "./config";
import {
  wfContentCache,
  workflowRunIdsForSession,
} from "./main-session-discovery";

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
    if (agentId.startsWith(EXTERNAL_AGENT_ID_PREFIX)) {
      // Synthetic external (Codex) nodes have no backing file to refresh their
      // activity clock, so a still-running one must not be reaped mid-run — but
      // bound the exemption: if the tool_result never arrives (Claude killed
      // mid-run), let it age out past a grace window instead of pinning its
      // ancestor subtree forever.
      if (
        agent.status === "running" &&
        now - agent.startTime <= MAX_EXTERNAL_RUN_MS
      )
        continue;
    } else if (agent.status === "running") {
      // Push/seed nodes have no backing file to refresh their activity clock,
      // so a running node whose single long tool (e.g. a 2-min build) emits no
      // interim hook must not be reaped mid-run — status is authoritative.
      // Bounded by MAX_EXTERNAL_RUN_MS so a process that dies without a terminal
      // event still clears instead of pinning its subtree forever.
      if (now - agent.startTime <= MAX_EXTERNAL_RUN_MS) continue;
    } else if (
      agent.status !== "idle" &&
      agent.status !== "completed" &&
      agent.status !== "error"
    ) {
      // waiting (awaiting user input) stays shielded.
      continue;
    }
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
 * Complete per-agent purge shared by both eviction loops in pruneState():
 * drops the agent from every tracking map and the spawn-index / pending-
 * reparent bookkeeping, tombstones its id, splices its edges, removes it
 * from its team, broadcasts the removal to viewers (warn wording set by
 * warnLabel), and tears down workflow runs for parentless mains.
 */
export function purgeAgent(agentId: string, warnLabel: string): void {
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
export function pruneState(): void {
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
