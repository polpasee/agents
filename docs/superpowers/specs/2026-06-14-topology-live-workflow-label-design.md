# Topology: live workflow-name fallback label

**Date:** 2026-06-14
**Status:** Approved

## Problem

Topology nodes for workflow sub-agents render the generic type label
`WORKFLOW-SUBAGENT` while a workflow is running, instead of a meaningful
label like `find:A-line-by-line`.

### Root cause (verified)

The real per-agent labels (`find:A-line-by-line`, `verify:p1-0`, …) reach the
renderer only through `WorkflowAgentRef.label`, which the monitor reads from
`<session>/workflows/wf_*.json` (`scanWorkflows` → store → join in
`useTopologyEffect` → `subLabel` in `renderNode`).

That run-state JSON is written by Claude Code **only when a workflow reaches a
terminal state**. Evidence: of 53 run-state files on disk, 50 are `completed`,
3 are `failed`, **0 are `running`**. A live run (e.g. `wf_04630933-619`) has its
agent transcripts under `subagents/workflows/<runId>/` but **no `wf_*.json`** —
only a `workflows/scripts/<name>-<runId>.js` source file. The live server's SSE
state confirms `"workflows":[]` while `workflow-subagent` nodes are present.

So during a live run the join has no data and `renderNode` falls back to the
type label. The exact per-agent labels are in-memory in the running Claude Code
process and are **not recoverable live from disk**. PR #23's render path is
correct; it is data-starved mid-run.

## Goal

While a workflow runs, show the **workflow name** (the one thing reliably on
disk live) as the node's sub-label instead of `WORKFLOW-SUBAGENT`. When the run
completes and `wf_*.json` lands, the real per-agent labels take over unchanged.

Non-goal: per-agent **phase** is not on disk live (only the script's phase
*titles*, with no agent→phase mapping), so it is out of scope. Live workflow
cluster *hulls* also remain completion-only.

## Approach (chosen: A — `AgentState.workflowName`)

Discovery already descends into `subagents/workflows/<runId>/`, so it knows each
workflow agent's `runId`. Stamp the workflow name onto the agent at discovery
time and use it as a render fallback. Rejected alternative B (synthesize a
running `WorkflowRunState`) was heavier and abused `WorkflowAgentRef.label`.

### Components & data flow

1. **`scanWorkflowScripts(projectPath, sessionId): Map<runId, name>`** — new
   helper in `scripts/lib/workflow-scan.ts`. Reads `<session>/workflows/scripts/`,
   parses each filename `^(.+)-(wf_[A-Za-z0-9-]+)\.js$` into `runId → name`.
   Missing dir → empty map. No JS execution (filename parse only).

2. **`scripts/lib/discovery.ts`** — once per session, build the script map.
   When registering a sub-agent whose transcript dir is
   `…/subagents/workflows/<runId>` (i.e. `path.basename(path.dirname(file.dir))
   === "workflows"`), derive `runId = path.basename(file.dir)` and pass
   `workflowName = scriptMap.get(runId)` to `registerAgent`.

3. **`AgentState` (`src/lib/types.ts`) + `registerAgent` (`agent-state.ts`)** —
   new optional `workflowName?: string`. Serialized whole over SSE, so it
   reaches the frontend with no transport changes.

4. **`renderNode.ts`** — fallback becomes:
   ```ts
   const liveFallback = agent.workflowName ? agent.workflowName.toUpperCase() : typeLabel;
   const subLabel = workflowLabel || liveFallback;
   ```
   Priority: real per-agent `workflowLabel` (completed run) >
   `workflowName` (live run) > `typeLabel` (non-workflow / unknown).

### Behavior matrix

| State                         | sub-label                       |
|-------------------------------|---------------------------------|
| Running workflow agent        | `CODE-REVIEW-MAX-CAPACITYAXIS`  |
| Completed workflow agent      | `find:A-line-by-line` (PR #23)  |
| Non-workflow sub-agent        | type label (unchanged)          |
| Main agent                    | repo name (unchanged)           |

## Testing

- `scanWorkflowScripts`: filename parse, runId extraction, missing/empty dir,
  non-matching filenames ignored.
- discovery: a workflow agent under `subagents/workflows/<runId>/` with a
  matching script file but **no** `wf_*.json` gets `workflowName` stamped; a
  flat sub-agent (not under `workflows/`) does not.
- `renderNode`: 3-way priority — `workflowLabel` wins over `workflowName`;
  `workflowName` wins over `typeLabel`; absent both → `typeLabel`.

## Out of scope / follow-up

`AgentList`/`AgentDetail` derive labels via the `useWorkflowLabels()` hook and
share the same live-data gap. The new `workflowName` field can later feed that
hook for a consistent fallback, but this change is topology-only as approved.
