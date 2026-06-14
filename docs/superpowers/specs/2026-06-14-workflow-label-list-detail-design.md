# Real workflow label in agent list + detail panel

**Date:** 2026-06-14
**Status:** Approved

## Problem

Workflow subagents render the static type text `WORKFLOW-SUBAGENT` in the
sidebar agent list and the agent detail panel, instead of their real workflow
label (e.g. `audit:dead-code`, `find:logic`) as named in the workflow's agent
table. The topology graph was already fixed for this (PR #23 / commit
`a3632cb`), but that fix only touched the hexagon sub-label in `renderNode.ts`.

- `src/components/AgentList.tsx:40` renders
  `(agent.displayType || AGENT_LABELS[agent.agentType]).toUpperCase()` →
  `WORKFLOW-SUBAGENT(Opus)` for every workflow agent.
- `src/components/AgentDetail.tsx:115-118` renders `agent.displayType`
  (`workflow-subagent`) as a secondary muted chip.

The real label already lives in the store: `workflows` Map →
`WorkflowRunState.agents[].label`. No ingestion/SSE/discovery change is needed —
only the front-end read sites.

## Approach (front-end read, ~5 files)

Extract the label-join logic (currently inlined in `useTopologyEffect.ts:72-77`)
into one shared helper so the three surfaces (topology, list, detail) never
diverge on the guard.

1. **`src/lib/workflowLabels.ts`** (new) — pure helper:
   ```ts
   export function buildWorkflowLabelMap(
     workflows: Map<string, WorkflowRunState>,
   ): Map<string, string>
   ```
   Builds `agentId → label` from each `run.agents[]`, set **only when
   meaningful**: `ref.label && ref.label !== ref.agentId` (the guard that skips
   the workflow-scan fallback where `label === agentId`). Identical semantics to
   the current inline loop.

2. **`src/hooks/useWorkflowLabels.ts`** (new) — `useWorkflowLabels()` reads
   `workflows` from the store and returns `buildWorkflowLabelMap(workflows)`,
   memoized on the `workflows` reference.

3. **`src/components/AgentList.tsx`** — call `useWorkflowLabels()` once in
   `AgentList`, thread the map through `SessionAgents` → `AgentRow` as a
   `workflowLabels` prop. In `AgentRow`, the type text becomes:
   `workflowLabels.get(agent.id) ?? (agent.displayType || AGENT_LABELS[agent.agentType]).toUpperCase()`.
   The model suffix `(${shortModel(...)})` is unchanged. The label is rendered
   **verbatim** (lowercase, prefix kept) — NOT uppercased — to match the
   workflow table and the topology.

4. **`src/components/AgentDetail.tsx`** — call `useWorkflowLabels()`, resolve
   `const wfLabel = workflowLabels.get(agent.id)`. The secondary chip shows
   `wfLabel ?? agent.displayType` (verbatim), keeping the existing
   "hide when it equals the primary label" guard. Primary label
   (`AGENT_LABELS[agent.agentType]`) is unchanged.

5. **`src/components/AgentGraph/useTopologyEffect.ts`** — replace the inline
   `agentIdToLabel` loop (lines 72-77) with `buildWorkflowLabelMap(workflows)`.
   Behavior identical; the node-datum assignment loop (78-81) is unchanged.

## Decisions

- **Case:** verbatim — `audit:dead-code` (lowercase, prefix kept). Not uppercased.
- **Fallback:** no matching workflow label → existing behavior unchanged
  (uppercased `displayType`/type label in the list; `displayType` chip in detail).
- **Data:** no discovery / SSE / store / type changes. `label` is already in the
  store on `WorkflowAgentRef`.
- **Threading vs hook-per-row:** build the map once in `AgentList` and pass it
  down, rather than calling the hook in each `AgentRow` (avoids N map builds /
  N store subscriptions).

## Testing

- Unit (`workflowLabels`): a `workflows` Map with a run whose ref has
  `label: "audit:dead-code"` / `agentId: "a1"` yields `{a1 → "audit:dead-code"}`;
  a ref with `label === agentId` is omitted; empty/absent label omitted.
- Component (`AgentList`): an agent with id matching a workflow ref renders
  `audit:dead-code` (verbatim, not uppercased); a non-workflow agent still
  renders its uppercased type (regression guard).
- Component (`AgentDetail`): a workflow agent renders `audit:dead-code` in the
  secondary chip instead of `workflow-subagent`; a non-workflow agent unchanged.
- Existing topology label test (`useTopologyEffect` / d3) stays green after the
  helper extraction.
