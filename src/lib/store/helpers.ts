import type { ActivityEntry, AgentEvent, AgentState, ErrorDetail, TeamState, TeamStatus } from "../types";

/** Derive team status from member statuses */
function computeTeamStatus(memberIds: string[], agents: Map<string, AgentState>, fallback: TeamStatus): TeamStatus {
  const members = memberIds.map(id => agents.get(id)).filter((a): a is AgentState => a !== undefined);
  if (members.some(a => a.status === "error")) return "error";
  if (members.every(a => a.status === "completed")) return "completed";
  if (members.some(a => a.status === "running" || a.status === "idle")) return "active";
  return fallback;
}

/**
 * Recompute the team-status entry for an agent's team after the agent's
 * status changed. Returns a new teams Map (or `null` if the agent has no
 * team / its team is unknown — caller should treat that as "no update").
 *
 * Closes M2: previously inlined in 3 cases (register / status / complete).
 */
export function recomputeTeamForAgent(
  agentId: string,
  agents: Map<string, AgentState>,
  teams: Map<string, TeamState>,
): Map<string, TeamState> | null {
  const agent = agents.get(agentId);
  if (!agent?.teamId) return null;
  const team = teams.get(agent.teamId);
  if (!team) return null;
  const newStatus = computeTeamStatus(team.memberIds, agents, team.status);
  const newTeams = new Map(teams);
  newTeams.set(team.id, { ...team, status: newStatus });
  return newTeams;
}

/**
 * Walk the ancestor chain of `eventAgentId` and return a new errorDetails
 * Map with `eventAgentId` appended to each already-errored ancestor's
 * cascadeIds. Returns `null` if no ancestor patches were needed.
 *
 * Semantic: when X errors NOW, append X to the cascadeIds of any ancestor
 * A that already errored (descendants-after). We approximate descendant-of
 * by walking parent links upward from X. Cycle-safe: bounded by agents.size
 * and a `seen` guard.
 *
 * Closes the Phase 1 follow-up to extract the cascade ancestor-walk verbatim
 * from PR #5 into a pure helper.
 */
export function findCascadeRelations(
  eventAgentId: string,
  agents: Map<string, AgentState>,
  errorDetails: Map<string, ErrorDetail>,
): Map<string, ErrorDetail> | null {
  const agent = agents.get(eventAgentId);
  if (!agent) return null;
  let next: Map<string, ErrorDetail> | null = null;
  const seen = new Set<string>([eventAgentId]);
  let cursorId = agent.parentId;
  const maxSteps = agents.size;
  let steps = 0;
  while (cursorId && !seen.has(cursorId) && steps++ < maxSteps) {
    seen.add(cursorId);
    const ancestorDetail = errorDetails.get(cursorId);
    if (ancestorDetail && !ancestorDetail.cascadeIds?.includes(eventAgentId)) {
      next = next ?? new Map(errorDetails);
      next.set(cursorId, {
        ...ancestorDetail,
        cascadeIds: [...(ancestorDetail.cascadeIds ?? []), eventAgentId],
      });
    }
    const ancestor = agents.get(cursorId);
    cursorId = ancestor?.parentId;
  }
  return next;
}

/**
 * Suppress duplicate events to reduce activity-log noise.
 * - agent:status: skip if same agent already has the same status in the
 *   last 5 entries.
 * - agent:register: skip if this agent was already registered anywhere in
 *   the activity log.
 * Other event types are never treated as duplicates.
 */
export function isDuplicateActivity(activity: ActivityEntry[], event: AgentEvent): boolean {
  if (event.type === "agent:status") {
    if (activity.length === 0) return false;
    for (let i = activity.length - 1; i >= Math.max(0, activity.length - 5); i--) {
      const prev = activity[i].event;
      if (prev.type === "agent:status" && prev.agentId === event.agentId) {
        return prev.status === event.status;
      }
    }
    return false;
  }
  if (event.type === "agent:register") {
    return activity.some((e) => e.event.type === "agent:register" && e.event.agentId === event.agentId);
  }
  return false;
}

export function loadLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = localStorage.getItem(key);
    if (val === null) return fallback;
    try { return JSON.parse(val); } catch { return val as T; }
  } catch { return fallback; }
}

/**
 * Counterpart to loadLocalStorage: guarded, throw-safe write. Strings are
 * stored raw (loadLocalStorage's parse-fallback reads them back as-is);
 * `null` removes the key. Quota / privacy-mode failures are silently
 * ignored so the caller's in-memory state update still proceeds.
 */
export function saveLocalStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch { /* quota / privacy mode — silently skip */ }
}
