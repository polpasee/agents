# Nested Sub-Agent Support (Claude Code v2.1.172+)

**Date:** 2026-06-11
**Status:** Approved for implementation

## Problem

Claude Code v2.1.172 introduced nested sub-agents: a sub-agent can spawn its own
sub-agents, up to 5 levels deep. The monitor currently hardcodes every discovered
sub-agent's `parentId` to the main session (`discovery.ts` Step 2), so nested
agents render mis-parented (anchored to the main node instead of their real
spawner). The store, SSE protocol, D3 hierarchy builder, cascade logic, and
session resolution are already depth-agnostic — discovery is the blocker.

## Verified on-disk format (live experiment, Claude Code 2.1.173)

A sub-agent spawned by another sub-agent writes its files **flat** into the same
directory as every other sub-agent of the session:

```
<project>/<sessionId>/subagents/agent-<id>.jsonl
<project>/<sessionId>/subagents/agent-<id>.meta.json
```

There are **no nested directories**. Parentage is recoverable only via
correlation:

- The child's `.meta.json` contains `toolUseId` — the ID of the `tool_use`
  block of the spawning `Agent` tool call.
- That `tool_use` block (name `"Agent"`; historically `"Task"`) lives in the
  **spawner's** JSONL: the session JSONL for depth-1 agents, the parent agent's
  `agent-<parent>.jsonl` for depth-2+.
- The child's own JSONL carries no parent pointer (`parentUuid: null`,
  `sessionId` = root session).

**Parent resolution rule:** `parentId = ownerOf(meta.toolUseId) ?? sessionId`.

## Design

### Backend: spawn index (scripts/lib/agent-state.ts)

- Module-level `spawnIndex: Map<toolUseId, agentId>` recording, for every
  `tool_use` block with name `Agent` or `Task` seen by `processEntryInner`
  (and a phase-A harvest helper), which agent emitted it. Persistent across
  poll ticks; entries for purged agents dropped during prune.
- `reparentAgent(agentId, newParentId)`: updates `agent.parentId`, swaps the
  backend parent edge, re-broadcasts `agent:register` with the new parentId.
- Both cleared by the existing test/state reset path.

### Backend: two-phase discovery (scripts/lib/discovery.ts Step 2)

Per tick, for each session's `subagents/` dir:

1. **Phase A (harvest):** read new lines of every fresh `agent-*.jsonl`
   (offsets advance once), parse into buffered entries, and harvest
   `Agent`/`Task` `tool_use` IDs into `spawnIndex`. The spawner's `tool_use`
   line is written before the child's files exist, so within a tick the index
   is complete before any registration.
2. **Phase B (register + process):** for each buffered file, resolve
   `parentId` from `meta.toolUseId` via `spawnIndex` (fall back to
   `sessionId` when the toolUseId is missing/unresolved or the resolved
   parent is not a live agent), register, then `processEntry` the buffered
   entries. Register parents before children (topological order over the
   tick's new agents) so the frontend never sees a child before its anchor.

The existing parent-session backfill and freshness bumps move into Phase B
unchanged.

### Backend: pending re-parent (cross-tick race)

If a child's `meta.toolUseId` cannot be resolved at registration (spawner's
JSONL line not yet flushed when its file was read that tick), register with the
`sessionId` fallback and record `agentId → toolUseId` in a pending map. At the
end of each scan, retry resolution; on success call `reparentAgent` and clear
the entry. Entries are dropped when their agent is purged.

### Frontend: adopt parentId on re-register (src/lib/store/eventHandlers.ts)

Add `parentId: "incoming"` to the `REGISTER_REFRESH` policy so a re-parent
broadcast updates the stored agent. When the merged `parentId` differs from
the existing one, replace the agent's parent edge (the edge with no `edgeType`
targeting this agent) with one from the new parent. The existing
`topologyDirty` check on parentId change then triggers a layout rebuild.

### Frontend: full ancestor restore (src/hooks/useFilteredAgents.ts)

Replace the one-level parent restore with a walk up the full ancestor chain
(queue + cycle guard), so a visible depth-N agent restores every filtered-out
ancestor up to its root anchor.

## Out of scope (follow-ups)

- Depth-scaled rendering polish: per-depth link distance, charge strength, and
  node radius (`config.ts`, `useTopologyEffect.ts`, `renderNode.ts`). Nested
  chains render correctly today, just with uniform spacing.
- Depth-aware stale thresholds in `selectStaleAgentIds`.

## Testing

- **agent-state:** spawn-index harvest (`Agent` and `Task` names, non-spawn
  tools ignored); `reparentAgent` state/edge/broadcast; reset clears the index.
- **discovery (fixture dirs):** depth-2 chain resolves child→parent (with the
  child's filename sorting before the parent's, the real readdir order);
  depth-5 chain; meta without `toolUseId` falls back to session; pending
  re-parent resolves on the next tick when the spawner's line appears late.
- **eventHandlers:** re-register with changed parentId updates agent, swaps
  the parent edge, sets `topologyDirty`.
- **useFilteredAgents:** depth-3 chain with hidden intermediate ancestors —
  all ancestors restored, cycle-safe.
- Full suite + type-check must pass (Step 4 of the workflow).
