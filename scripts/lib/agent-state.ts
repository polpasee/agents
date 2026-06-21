// ── agent-state barrel ────────────────────────────────
// Re-exports the full public API so all existing importers
// (discovery.ts, background-tasks.ts, src/app/api/stream/route.ts,
//  logs route, sse-broadcast.ts) continue to work unchanged.
//
// Decomposition:
//   agent-store.ts      — HMR singleton state (globalThis) + workflow helpers
//   parse-agent-type.ts — pure parseAgentType classifier
//   spawn-index.ts      — spawn tool_use id index
//   agent-registry.ts   — register/reparent/broadcastRegisterFor/updateAgentStatus
//   entry-processor.ts  — processEntry / processEntryInner
//
// Import direction (no cycles):
//   sse-broadcast ← agent-store ← spawn-index ← entry-processor ← (barrel)
//                              ← agent-registry ← entry-processor ← (barrel)

export {
  agents,
  edges,
  teams,
  agentLastModified,
  removedAgentIds,
  agentFilePaths,
  workflows,
  spawnIndex,
  pendingReparents,
  upsertWorkflow,
  removeWorkflow,
  getAgentFilePath,
} from "./agent-store";

export { parseAgentType } from "./parse-agent-type";

export {
  recordSpawnToolUse,
  harvestSpawnToolUses,
  resolveSpawnOwner,
  resolveLiveSpawner,
  dropSpawnEntriesFor,
} from "./spawn-index";

export {
  registerAgent,
  broadcastRegisterFor,
  reparentAgent,
  updateAgentStatus,
} from "./agent-registry";

export { processEntry } from "./entry-processor";

// Re-exports so call sites that already import from agent-state keep working.
export { viewers, broadcast } from "./sse-broadcast";
