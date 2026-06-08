# Workflow Monitoring — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)

## Problem

The monitor already tracks every agent a Workflow spawns: the discovery loop is
purely filesystem-path based (`scripts/lib/discovery.ts` Step 2), so any
`~/.claude/projects/<project>/<sessionId>/subagents/agent-<id>.jsonl` is picked
up, parented to its main session, and streamed live — regardless of whether it
was spawned by the Task tool, the Agent tool, a Team, or a Workflow `agent()`
call.

What's missing is **the workflow itself**. Workflow agents render as a flat fan
of individual children under the main session. The monitor has no concept of a
workflow run, its phases, or its pipeline/parallel structure, because it never
reads `<sessionId>/workflows/wf_*.json`. Agents spawned with the default
subagent type show as `generic` with the prompt as their label rather than the
workflow's phase/label (e.g. `find:A-arialabel`).

## Goal

Add a workflow-aware grouping overlay:

- A **container per run** in the topology graph, with agents clustered by phase.
- A standing **Workflows panel** listing runs with rollups.
- A click-to-open **detail overlay** per run (phases, rollups, per-agent table).

## Source data: `wf_*.json`

Each run writes `<sessionId>/workflows/wf_<id>.json`. Relevant shape (verified
against real files on disk):

```jsonc
{
  "runId": "wf_1abd6ed8-fdb",
  "workflowName": "code-review-max-pr1055",
  "status": "completed",            // completed | failed | (absent => running)
  "startTime": 1780904327007,
  "durationMs": 916017,
  "agentCount": 18,
  "totalTokens": 1234567,
  "totalToolCalls": 214,
  "summary": "code-review max: finder angles + verify + sweep",
  "phases": [
    { "title": "Find",   "detail": "finder angles ..." },
    { "title": "Verify", "detail": "adversarial verifier ..." },
    { "title": "Sweep",  "detail": "fresh reviewer hunts gaps" }
  ],
  "workflowProgress": [
    { "type": "workflow_phase", "index": "1", "title": "Find" },
    {
      "type": "workflow_agent", "index": "1",
      "label": "find:A-arialabel", "phaseIndex": "1", "phaseTitle": "Find",
      "agentId": "ac37e2d69fd1abf90",       // joins to subagents/agent-<id>.jsonl
      "model": "claude-opus-4-8[1m]", "state": "done",
      "tokens": "36188", "toolCalls": "12", "durationMs": "66957",
      "startedAt": "1780904327016"
    }
    // ...
  ]
}
```

**Join key:** `workflowProgress[type=workflow_agent].agentId` matches the
`subagents/agent-<agentId>.jsonl` filename exactly, and thus `AgentState.id`.
The agent JSONL itself carries **no** back-reference to its workflow — the wf
file is the only join source.

**Liveness:** all wf files observed on disk are terminal (`completed`/`failed`)
and carry end-state fields (`durationMs`, `result`, final `totalTokens`),
indicating they are finalized at run end. The design re-reads wf files on every
full scan, so if the runtime flushes incrementally the overlay updates live; if
not, the overlay appears at run completion. Either way the grouping is
**eventually-consistent** and the implementation is identical.

## Data model

New types in `src/lib/types.ts` (the single source of truth for the SSE wire
contract):

```ts
export type WorkflowStatus = "running" | "completed" | "failed";

export interface WorkflowPhase {
  index: number;
  title: string;
  detail?: string;
}

export interface WorkflowAgentRef {
  agentId: string;        // joins to AgentState.id / subagents/agent-<id>.jsonl
  label: string;          // "find:A-arialabel"
  phaseIndex?: number;
  phaseTitle?: string;
  model?: string;
  state: string;          // "done" | "running" | "error" | ...
  tokens?: number;        // snapshot from the wf file
  toolCalls?: number;
  durationMs?: number;
}

export interface WorkflowRunState {
  runId: string;          // "wf_1abd6ed8-fdb"
  sessionId: string;      // parent main session (from the dir path)
  name: string;           // workflowName
  status: WorkflowStatus;
  startTime: number;
  durationMs?: number;
  agentCount: number;
  totalTokens?: number;
  totalToolCalls?: number;
  summary?: string;
  phases: WorkflowPhase[];
  agents: WorkflowAgentRef[];
}
```

**`AgentState` is unchanged.** The topology learns each agent's run/phase from a
client-derived `Map<agentId, { runId: string; phaseTitle?: string }>` built off
the workflows array. This keeps the agent model clean and avoids any clash with
live token tracking.

### Lifecycle

A run is loaded **only for currently-tracked sessions** (those present in the
`agents` map). When a main session is purged by `pruneState`, its runs are
dropped and a removal is broadcast. This bounds memory naturally, ties run
lifecycle to its session, and avoids loading ancient history. No separate TTL.

## Backend

### `scripts/lib/workflow-scan.ts` (new)

- `parseWorkflowFile(filePath: string, sessionId: string): WorkflowRunState | null`
  — pure and fully testable. Maps `workflowProgress[type=workflow_agent]` →
  `WorkflowAgentRef[]` (coercing the string-typed numeric fields), `phases` →
  `WorkflowPhase[]`, and lifts `status` / `agentCount` / `totalTokens` /
  `totalToolCalls` / `durationMs` / `summary`. Tolerates missing fields; absent
  `status` ⇒ `"running"`. Returns `null` on unparseable/empty files.
- `scanWorkflows(projectPath: string, sessionId: string): WorkflowRunState[]`
  — reads `<projectPath>/<sessionId>/workflows/wf_*.json` and parses each.

### `scripts/lib/discovery.ts`

Add a **Step 1.5** inside the existing per-session walk, run right after a main
session is confirmed tracked, on the full-scan cadence (cheap — a handful of
small JSON files per session). For each parsed run, upsert into the workflows
map and broadcast a delta when new or content-changed (content-hash compare so
re-scans stay quiet).

In `pruneState`, when a main agent is evicted, also delete workflows whose
`sessionId` equals the removed main and broadcast `workflow:remove`.

### `scripts/lib/agent-state.ts`

Add `workflows: Map<string, WorkflowRunState>` to the
`globalThis.__agentMonitorState` singleton (HMR-safe, mirroring `teams`). Export
it. Add upsert/remove helpers that broadcast the deltas below.

### Protocol — additive, no version bump

Per the contract in `types.ts` (new optional fields and new event variants are
permissive, not breaking):

- `state:sync` gains `workflows: WorkflowRunState[]`.
- Two new `ServerEvent` variants:
  - `{ type: "workflow:update"; workflow: WorkflowRunState }`
  - `{ type: "workflow:remove"; runId: string }`
- `src/app/api/stream/route.ts` includes `workflows` in the initial sync.
- `src/lib/validation.ts` validates the two new variants.

## Frontend

### Store (`src/lib/store.ts`)

- Hold `workflows: WorkflowRunState[]` (or a Map; match the teams approach).
- Extend `syncState(agents, edges, teams, workflows)` to accept workflows.
- Handle `workflow:update` (upsert) and `workflow:remove`.
- Expose a memoized selector `agentId → { runId, phaseTitle? }` for the topology.

### `src/components/WorkflowPanel.tsx` (new, mirrors `TeamPanel.tsx`)

Standing list of runs: name, status chip, agentCount, total tokens. Row click
opens the detail overlay.

### `src/components/WorkflowDetail.tsx` (new, mirrors `AgentDetail.tsx` overlay)

- Rollups: status · agents · duration · tokens · toolCalls.
- Per-phase progress bars (`done/total`).
- Per-agent table: label · model · tokens · state. Clicking an agent row
  focuses that node in the topology.

### Topology (`src/components/AgentGraph/`)

New `useWorkflowHullsEffect.ts` draws a container hull per run with agents
clustered by phase, reusing the existing team-hull rendering approach in
`useTopologyEffect.ts`. Default-type workflow agents render with their wf
`label` instead of `generic`.

### Dashboard

Wire `WorkflowPanel` into `src/components/Dashboard.tsx`.

## Testing (TDD, matching existing `__tests__` layout)

- `scripts/lib/__tests__/workflow-scan.test.ts`: real-shaped fixture →
  `WorkflowRunState`; `failed` status; absent status ⇒ `running`; no-phase
  workflow; default-type agents (label preserved); missing/garbage fields →
  `null` or graceful defaults.
- `src/lib/__tests__/store-workflows.test.ts`: sync + upsert + remove; the
  derived agent→run index.
- `src/components/__tests__/WorkflowPanel.test.tsx` and
  `WorkflowDetail.test.tsx`: render rollups, phase bars, agent table, row-click
  focus.
- Validation tests for `workflow:update` / `workflow:remove`.

## Scope boundaries (YAGNI)

**Out of scope:**

- Replay integration — replay continues to scrub agents/edges/teams only;
  workflows are excluded (noted in code).
- Workflow annotations.
- Workflow cost projection.

Run rollups use the wf snapshot; live agents keep their own live tokens in the
topology (the wf `tokens` are a per-run display snapshot, not a source of truth
for live agent token counts).

## Known limitation

The grouping overlay is eventually-consistent: a run's container appears once
its wf file is written. If the runtime writes wf files only at completion, the
overlay appears at run end; if it flushes incrementally, phases fill in live.
The design re-reads on each scan, so it adapts automatically with no code
change.
