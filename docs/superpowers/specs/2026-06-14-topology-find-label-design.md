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

## Approach (front-end join, ~12 lines, 2 files)

Reuse the existing agentId→ref join. No new `AgentState` field, no `discovery.ts`
/ SSE / ingestion changes.

1. **`src/components/AgentGraph/useTopologyEffect.ts`**
   - In the existing `for (const ref of run.agents)` loop, also build
     `agentIdToLabel: Map<string, string>` from `ref.label`.
   - Pass the looked-up label into `renderNodeVisuals(...)` as a new trailing
     arg at the initial-render call site (this file). Mirror the same lookup at
     the in-place refresh call site (Effect 2b / node-refresh effect) so live
     updates keep the label.

2. **`src/lib/d3/renderNode.ts`**
   - Add optional param `workflowLabel?: string` to `renderNodeVisuals`.
   - When `workflowLabel` is present **and meaningful** (non-empty and not equal
     to the agent's raw id — guards the workflow-scan fallback where
     `label === agentId`), use it **verbatim** as `typeLabel` (skip the
     `split(":").pop().toUpperCase()` transform) so `find:` prefix + lowercase
     are preserved as in the reference image.
   - Otherwise behavior is unchanged: `displayType` → existing transform.
   - `centerText` (model name / initial) is unaffected.

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
