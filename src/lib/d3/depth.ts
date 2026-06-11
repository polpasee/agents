import { GRAPH } from "@/lib/config";
import type { AgentState } from "@/lib/types";

/** Hard cap on parent-chain walks — Claude Code allows ≤5 nesting levels,
 *  so anything deeper indicates corrupt data. */
const MAX_DEPTH = 10;

/**
 * Nesting depth of an agent: 0 for agents without parentId, else 1 + the
 * parent's depth. Cycle-guarded (visited set) and capped at MAX_DEPTH; a
 * parentId pointing at an unknown agent still counts as one level.
 */
export function agentDepth(agentId: string, agents: Map<string, AgentState>): number {
  let depth = 0;
  const visited = new Set<string>([agentId]);
  let current = agents.get(agentId);
  while (current?.parentId && depth < MAX_DEPTH) {
    if (visited.has(current.parentId)) break; // cycle guard
    visited.add(current.parentId);
    depth++;
    current = agents.get(current.parentId);
  }
  return depth;
}

/**
 * Gentle per-level shrink applied to sub-agent link distance, charge
 * strength, and node radius. Depth ≤1 is exactly 1 so direct sub-agents
 * render unchanged; deeper levels decay by GRAPH.depthScale per level,
 * floored at GRAPH.depthScaleMin.
 */
export function depthFactor(depth: number): number {
  return depth <= 1 ? 1 : Math.max(GRAPH.depthScaleMin, Math.pow(GRAPH.depthScale, depth - 1));
}
