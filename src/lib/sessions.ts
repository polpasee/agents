import type { AgentState } from "./types";

/**
 * Canonical session id: walk parentId to the root (parentless or missing
 * parent), cycle-safe. Returns the root agent's sessionId, or the root
 * agent's own id when sessionId is absent.
 */
export function resolveSessionId(
  agent: AgentState,
  agents: Map<string, AgentState>,
): string {
  let cur = agent;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = agents.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.sessionId || cur.id;
}
