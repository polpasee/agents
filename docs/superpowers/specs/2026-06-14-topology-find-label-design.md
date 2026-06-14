# Topology node sub-label: show real workflow label

**Date:** 2026-06-14
**Status:** Approved

## Problem

In the topology graph, the sub-label rendered *under* each workflow-subagent
node shows the generic type text `WORKFLOW-SUBAGENT`. It should instead show the
agent's real workflow label — e.g. `find:A-line-scan`, `find:B-removed-behavior`
— exactly as the workflow names them.

## Root cause

- `renderNode.ts:28-29` derives the sub-label from `agent.displayType`, which for
  workflow subagents is `"workflow-subagent"` (set in `scripts/lib/discovery.ts`).
  It then runs `rawDisplay.split(":").pop()!.toUpperCase()` → `WORKFLOW-SUBAGENT`.
- The real label lives on `WorkflowAgentRef.label` inside
  `WorkflowRunState.agents[]` (store `workflows` Map). It is **already joined to
  nodes by `agentId`** in `useTopologyEffect.ts:241-246`, but only `runId` and
  `phaseTitle` are captured from each ref — `label` is dropped.

## Approach (front-end join, ~20 lines, 4 files)

Reuse the existing agentId→ref join. No new `AgentState` field, no `discovery.ts`
/ SSE / ingestion changes.

Effect 2b (`useNodeVisualsEffect.ts`) re-renders nodes in place but does **not**
receive the `workflows` Map. Rather than plumb `workflows` through `index.tsx`
and that hook, we stash the resolved label on the `SimNode` datum during the
topology build (Effect 1), where the join already runs. Both render call sites
then read it off the node datum they already hold.

1. **`src/lib/d3/updateLinks.ts`** — add optional `workflowLabel?: string` to the
   `SimNode` interface.

2. **`src/components/AgentGraph/useTopologyEffect.ts`**
   - Build `agentIdToLabel: Map<string, string>` from each `ref.label`, set
     **only when meaningful** (`ref.label` non-empty and `!== ref.agentId`, which
     guards the workflow-scan fallback where `label === agentId`). Build it
     *before* the initial node render so it's available on first paint.
   - Set `node.workflowLabel = agentIdToLabel.get(node.id)` on each `SimNode`.
   - Pass `d.workflowLabel` into the initial `renderNodeVisuals(...)` call.

3. **`src/components/AgentGraph/useNodeVisualsEffect.ts`** (Effect 2b)
   - Pass `d.workflowLabel` into its `renderNodeVisuals(...)` call (datum already
     in scope; no Options change).

4. **`src/lib/d3/renderNode.ts`**
   - Add optional param `workflowLabel?: string` to `renderNodeVisuals`.
   - When `workflowLabel` is truthy, use it **verbatim** as `typeLabel` (skip the
     `split(":").pop().toUpperCase()` transform) so `find:` prefix + lowercase
     are preserved as in the reference image. The meaningfulness guard already
     lives at the map-build step, so renderNode only needs a truthy check.
   - Otherwise behavior is unchanged: `displayType` → existing transform.
   - `centerText` (model name / initial) is unaffected — keep deriving it from
     the existing `typeLabel`/model logic, not from `workflowLabel`.

## Decisions

- **Case:** literal — `find:A-line-scan` (lowercase, prefix kept). Not uppercased.
- **Fallback:** label equal to raw `agentId` (no explicit workflow label) →
  keep current `WORKFLOW-SUBAGENT`. Non-workflow nodes untouched.
- **Long labels:** rendered as-is, no truncation (revisit only if it overflows).

## Testing

- Unit (d3): node whose agent matches a workflow ref with `label: "find:A-line-scan"`
  renders that exact text under the hex; case/prefix preserved.
- Unit (d3): node with no matching workflow ref still renders its type label
  (regression guard for non-workflow nodes).
- Existing `discovery.test.ts` displayType assertions remain green (ingestion
  untouched).
```
