import { spawnIndex, agents } from "./agent-store";

// ── Spawn index: tool_use id → spawning agent ─────────
// A nested sub-agent's meta.json carries the toolUseId of the `Agent`/`Task`
// tool_use block that spawned it; that block lives in the spawner's JSONL.
// Recording every spawn block's owner here is what lets discovery resolve a
// child's real parent instead of anchoring it to the main session.

/** Record the spawning agent for a single Agent/Task tool_use block. */
export function recordSpawnToolUse(
  block: Record<string, unknown>,
  agentId: string,
): void {
  if (block.type !== "tool_use") return;
  if (block.name !== "Agent" && block.name !== "Task") return;
  if (typeof block.id !== "string" || block.id.length === 0) return;
  // First write wins: forked/resumed sessions replay the original
  // transcript's spawn lines verbatim, and a later harvest must not steal
  // ownership from the agent that actually issued the call.
  if (spawnIndex.has(block.id)) return;
  spawnIndex.set(block.id, agentId);
}

/**
 * Phase-A harvest: record Agent/Task spawn tool_use ids from an
 * already-parsed JSONL entry. Discovery runs this over every fresh
 * sub-agent file before registering anything, so the index is complete
 * even when readdir lists a child before its spawner.
 */
export function harvestSpawnToolUses(
  entry: Record<string, unknown>,
  agentId: string,
): void {
  const msg = entry.message;
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block && typeof block === "object") {
      recordSpawnToolUse(block as Record<string, unknown>, agentId);
    }
  }
}

/** Resolve which agent emitted the given spawn tool_use id, if known. */
export function resolveSpawnOwner(toolUseId: string): string | undefined {
  return spawnIndex.get(toolUseId);
}

/**
 * Resolve a spawn tool_use id to a spawner that is usable as `selfId`'s
 * parent: known, not the agent itself, and accepted by `isLive` (registered
 * agents by default; discovery's dependency sort passes the tick's batch).
 * All parent-resolution sites must go through this so the guards never drift.
 */
export function resolveLiveSpawner(
  toolUseId: string,
  selfId: string,
  isLive: (id: string) => boolean = (id) => agents.has(id),
): string | undefined {
  const owner = spawnIndex.get(toolUseId);
  if (owner === undefined || owner === selfId || !isLive(owner))
    return undefined;
  return owner;
}

/** Drop spawn-index entries owned by a purged agent. */
export function dropSpawnEntriesFor(agentId: string): void {
  for (const [toolUseId, owner] of spawnIndex) {
    if (owner === agentId) spawnIndex.delete(toolUseId);
  }
}
