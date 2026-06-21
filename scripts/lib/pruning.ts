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
import { REMOVED_IDS_TTL_MS } from "./config";
import {
  selectLosingMains,
  selectStaleAgentIds,
  wfContentCache,
  workflowRunIdsForSession,
} from "./main-session-discovery";

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
