# Workflow Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow-aware grouping overlay (read wf_*.json) to the agent monitor: a container per run in the topology, a Workflows panel, and a click-to-open detail overlay — mirroring the existing Team machinery.

**Architecture:** A post-hoc overlay keyed off `<session>/workflows/wf_*.json`, joined to already-tracked subagents via `workflow_agent.agentId`. Backend scans wf files in the discovery loop and broadcasts additive SSE deltas; frontend mirrors the Team store/panel/topology patterns.

**Tech Stack:** Next.js (App Router), TypeScript, Zustand (sliced store), D3 force simulation, Vitest, @testing-library/react.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|--------------|----------------|
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/types.ts` | Modify | Add WorkflowStatus, WorkflowPhase, WorkflowAgentRef, WorkflowRunState; extend state:sync and add two ServerEvent variants |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/validation.ts` | Modify | Add isWorkflowRunState guard; handle workflow:update and workflow:remove cases |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/validation.test.ts` | Modify | Add workflow event validation test cases |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/workflow-scan.ts` | Create | parseWorkflowFile and scanWorkflows — pure file-to-type transforms |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/__tests__/workflow-scan.test.ts` | Create | Real-temp-dir fixture tests for the scanner |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/agent-state.ts` | Modify | Add workflows Map to singleton; export upsertWorkflow, removeWorkflow |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/discovery.ts` | Modify | Call scanWorkflows after updateAgentStatus; prune workflows in both eviction loops |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/app/api/stream/route.ts` | Modify | Include workflows array in state:sync payload |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/hooks/useEventStream.ts` | Modify | Pass workflows to syncState; handle workflow:update and workflow:remove events |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/types.ts` | Modify | Add workflows Map, selectedWorkflowId, syncState 4th arg, upsertWorkflow, removeWorkflow, selectWorkflow to AgentStore |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/agentSlice.ts` | Modify | Add workflows Map initial value; extend syncState; add upsertWorkflow, removeWorkflow; add to AgentSlice Pick |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/uiSlice.ts` | Modify | Add selectedWorkflowId, selectWorkflow; add to UISlice Pick |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/store-workflows.test.ts` | Create | Mirror store-teams.test.ts for syncState-with-workflows, upsertWorkflow, removeWorkflow, selectWorkflow |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/test-utils.ts` | Modify | Pass 4th arg [] to syncState; call selectWorkflow(null) in resetStore |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowPanel.tsx` | Create | Standing sidebar list of workflow runs, mirrors TeamPanel |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowPanel.test.tsx` | Create | RTL tests for WorkflowPanel render and click |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowDetail.tsx` | Create | Overlay: rollups, per-phase progress bars, per-agent table |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowDetail.test.tsx` | Create | RTL tests for WorkflowDetail render and agent row click |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/Dashboard.tsx` | Modify | Mount WorkflowPanel after TeamPanel; mount WorkflowDetail overlay |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/AgentGraph/useTopologyEffect.ts` | Modify | Add workflow hull group, workflowNodeMap, workflow tick block with hull/label/phase centroid labels |
| `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/AgentGraph/index.tsx` | Modify | Read workflows and selectedWorkflowId from store; pass to useTopologyEffect |

---

### Task 1: Types — add workflow data model to src/lib/types.ts

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/types.ts` (after line 161, after `TeamState`; line 96 `ServerEvent` union; line 96 `state:sync` variant)

- [ ] Open `src/lib/types.ts`. After the `TeamState` interface (line ~161), insert the four new workflow types:

```typescript
// ── Workflow Monitoring ───────────────────────────────
export type WorkflowStatus = "running" | "completed" | "failed";

export interface WorkflowPhase {
  index: number;
  title: string;
  detail?: string;
}

export interface WorkflowAgentRef {
  agentId: string;
  label: string;
  phaseIndex?: number;
  phaseTitle?: string;
  model?: string;
  state: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}

export interface WorkflowRunState {
  runId: string;
  sessionId: string;
  name: string;
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

- [ ] On line 96, replace the `state:sync` variant with one that adds the optional `workflows` field, and append the two new event variants to the `ServerEvent` union:

```typescript
// Events sent from server to dashboard
export type ServerEvent =
  | { type: "state:sync"; agents: AgentState[]; edges: EdgeState[]; teams: TeamState[]; workflows?: WorkflowRunState[]; protocolVersion?: number }
  | { type: "state:update"; event: AgentEvent; timestamp: number }
  | { type: "state:remove"; agentId: string }
  | { type: "log:response"; agentId: string; entries: LogEntry[] }
  | { type: "log:error"; agentId: string; error: string }
  | { type: "annotation:sync"; annotations: Annotation[] }
  | { type: "annotation:update"; annotation: Annotation; action: "add" | "remove" }
  | { type: "workflow:update"; workflow: WorkflowRunState }
  | { type: "workflow:remove"; runId: string };
```

- [ ] Run typecheck to confirm no regressions:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0, no errors.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/lib/types.ts && git commit -m "feat(types): add WorkflowStatus/Phase/AgentRef/RunState and new ServerEvent variants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Validation — guard workflow SSE events

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/validation.ts` (before the `default` case at line 44)
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/validation.test.ts` (append new describe block)

- [ ] Write the failing tests first. Append to `src/lib/__tests__/validation.test.ts` after the last closing `});`:

```typescript
describe("workflow event validation", () => {
  const validWorkflow = {
    runId: "wf_abc",
    sessionId: "sess-1",
    name: "code-review",
    status: "completed",
    startTime: 1000,
    agentCount: 3,
    phases: [],
    agents: [],
  };

  it("accepts workflow:update with valid WorkflowRunState", () => {
    expect(isValidServerEvent({ type: "workflow:update", workflow: validWorkflow })).toBe(true);
  });

  it("rejects workflow:update with missing runId", () => {
    const bad = { ...validWorkflow, runId: undefined };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(false);
  });

  it("rejects workflow:update with missing workflow field", () => {
    expect(isValidServerEvent({ type: "workflow:update" })).toBe(false);
  });

  it("accepts workflow:remove with string runId", () => {
    expect(isValidServerEvent({ type: "workflow:remove", runId: "wf_abc" })).toBe(true);
  });

  it("rejects workflow:remove without runId", () => {
    expect(isValidServerEvent({ type: "workflow:remove" })).toBe(false);
  });

  it("rejects workflow:remove with non-string runId", () => {
    expect(isValidServerEvent({ type: "workflow:remove", runId: 42 })).toBe(false);
  });
});
```

- [ ] Run the new tests to confirm they fail:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/lib/__tests__/validation.test.ts
  ```
  Expected: 6 new tests fail (unknown type / missing cases).

- [ ] Add `isWorkflowRunState` module-local guard and two new switch cases in `src/lib/validation.ts`. The full modified file:

```typescript
import type { AgentEvent, ServerEvent, AgentStatus, AgentType } from "./types";

function isAnnotationShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const ann = v as Record<string, unknown>;
  return typeof ann.id === "string" && typeof ann.targetId === "string";
}

const AGENT_STATUSES: readonly AgentStatus[] = ["running", "waiting", "idle", "completed", "error"];
const AGENT_TYPES: readonly AgentType[] = ["main", "explore", "plan", "build", "review", "test", "team-lead", "generic"];

function isAgentStatus(v: unknown): v is AgentStatus {
  return typeof v === "string" && (AGENT_STATUSES as readonly string[]).includes(v);
}

function isAgentType(v: unknown): v is AgentType {
  return typeof v === "string" && (AGENT_TYPES as readonly string[]).includes(v);
}

function isWorkflowRunState(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.runId === "string" &&
    typeof r.sessionId === "string" &&
    typeof r.name === "string" &&
    typeof r.status === "string" &&
    typeof r.startTime === "number" &&
    typeof r.agentCount === "number" &&
    Array.isArray(r.phases) &&
    Array.isArray(r.agents)
  );
}

/** Validate that a parsed object is a well-formed ServerEvent */
export function isValidServerEvent(data: unknown): data is ServerEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case "state:sync":
      return (
        Array.isArray(obj.agents) &&
        Array.isArray(obj.edges) &&
        Array.isArray(obj.teams) &&
        (obj.protocolVersion === undefined || typeof obj.protocolVersion === "number")
      );
    case "state:update":
      return typeof obj.timestamp === "number" && isValidAgentEvent(obj.event);
    case "state:remove":
      return typeof obj.agentId === "string";
    case "annotation:sync":
      return Array.isArray(obj.annotations) && obj.annotations.every(isAnnotationShape);
    case "annotation:update":
      if (obj.action !== "add" && obj.action !== "remove") return false;
      return isAnnotationShape(obj.annotation);
    case "workflow:update":
      return isWorkflowRunState(obj.workflow);
    case "workflow:remove":
      return typeof obj.runId === "string";
    default:
      return false;
  }
}

/** Validate that a parsed object is a well-formed AgentEvent */
export function isValidAgentEvent(data: unknown): data is AgentEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case "agent:register":
      return typeof obj.agentId === "string" && isAgentType(obj.agentType) && typeof obj.task === "string";
    case "agent:status":
      return typeof obj.agentId === "string" && isAgentStatus(obj.status);
    case "agent:tool_call":
      return typeof obj.agentId === "string" && typeof obj.tool === "string";
    case "agent:tokens":
      return typeof obj.agentId === "string" && typeof obj.inputTokens === "number";
    case "agent:message":
      return typeof obj.fromId === "string" && typeof obj.toId === "string";
    case "agent:complete":
      return typeof obj.agentId === "string" && typeof obj.duration === "number";
    default:
      return false;
  }
}
```

- [ ] Run the full validation test file to confirm all tests pass:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/lib/__tests__/validation.test.ts
  ```
  Expected: all tests pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/lib/validation.ts src/lib/__tests__/validation.test.ts && git commit -m "feat(validation): add isWorkflowRunState guard and workflow SSE event cases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Backend scanner — scripts/lib/workflow-scan.ts

**Files:**
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/workflow-scan.ts`
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/__tests__/workflow-scan.test.ts`

- [ ] Write the failing tests first. Create `scripts/lib/__tests__/workflow-scan.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parseWorkflowFile, scanWorkflows } from "../workflow-scan";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-scan-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const FULL_FIXTURE = {
  runId: "wf_1abd6ed8-fdb",
  workflowName: "code-review-max-pr1055",
  status: "completed",
  startTime: 1780904327007,
  durationMs: 916017,
  agentCount: 18,
  totalTokens: 1234567,
  totalToolCalls: 214,
  summary: "code-review max: finder angles + verify + sweep",
  phases: [
    { title: "Find",   detail: "finder angles ..." },
    { title: "Verify", detail: "adversarial verifier ..." },
    { title: "Sweep",  detail: "fresh reviewer hunts gaps" },
  ],
  workflowProgress: [
    { type: "workflow_phase", index: "1", title: "Find" },
    {
      type: "workflow_agent",
      index: "1",
      label: "find:A-arialabel",
      phaseIndex: "1",
      phaseTitle: "Find",
      agentId: "ac37e2d69fd1abf90",
      model: "claude-opus-4-8[1m]",
      state: "done",
      tokens: "36188",
      toolCalls: "12",
      durationMs: "66957",
      startedAt: "1780904327016",
    },
    {
      type: "workflow_agent",
      index: "2",
      label: "verify:B",
      phaseIndex: "2",
      phaseTitle: "Verify",
      agentId: "bc12345",
      model: "claude-sonnet-4-5",
      state: "done",
      tokens: "12000",
      toolCalls: "5",
      durationMs: "30000",
      startedAt: "1780904393973",
    },
  ],
};

describe("parseWorkflowFile", () => {
  it("parses the full happy-path fixture correctly", async () => {
    const filePath = path.join(tmpDir, "wf_1abd6ed8-fdb.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).not.toBeNull();
    expect(result!.runId).toBe("wf_1abd6ed8-fdb");
    expect(result!.sessionId).toBe("sess-abc");
    expect(result!.name).toBe("code-review-max-pr1055");
    expect(result!.status).toBe("completed");
    expect(result!.startTime).toBe(1780904327007);
    expect(result!.durationMs).toBe(916017);
    expect(result!.agentCount).toBe(18);
    expect(result!.totalTokens).toBe(1234567);
    expect(result!.totalToolCalls).toBe(214);
    expect(result!.summary).toBe("code-review max: finder angles + verify + sweep");
  });

  it("maps phases with index, title, and detail", async () => {
    const filePath = path.join(tmpDir, "wf_phases.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.phases).toHaveLength(3);
    expect(result!.phases[0]).toEqual({ index: 1, title: "Find", detail: "finder angles ..." });
    expect(result!.phases[1]).toEqual({ index: 2, title: "Verify", detail: "adversarial verifier ..." });
    expect(result!.phases[2]).toEqual({ index: 3, title: "Sweep", detail: "fresh reviewer hunts gaps" });
  });

  it("maps workflow_agent entries to WorkflowAgentRef with coerced numeric fields", async () => {
    const filePath = path.join(tmpDir, "wf_agents.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.agents).toHaveLength(2);
    const agent = result!.agents[0];
    expect(agent.agentId).toBe("ac37e2d69fd1abf90");
    expect(agent.label).toBe("find:A-arialabel");
    expect(agent.phaseIndex).toBe(1);
    expect(agent.phaseTitle).toBe("Find");
    expect(agent.model).toBe("claude-opus-4-8[1m]");
    expect(agent.state).toBe("done");
    expect(agent.tokens).toBe(36188);
    expect(agent.toolCalls).toBe(12);
    expect(agent.durationMs).toBe(66957);
  });

  it("defaults absent status to 'running'", async () => {
    const fixture = { ...FULL_FIXTURE };
    const { status: _s, ...withoutStatus } = fixture;
    const filePath = path.join(tmpDir, "wf_running.json");
    await fs.writeFile(filePath, JSON.stringify(withoutStatus));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.status).toBe("running");
  });

  it("handles 'failed' status", async () => {
    const fixture = { ...FULL_FIXTURE, status: "failed" };
    const filePath = path.join(tmpDir, "wf_failed.json");
    await fs.writeFile(filePath, JSON.stringify(fixture));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.status).toBe("failed");
  });

  it("handles workflow with no phases", async () => {
    const fixture = { ...FULL_FIXTURE, phases: [] };
    const filePath = path.join(tmpDir, "wf_nophases.json");
    await fs.writeFile(filePath, JSON.stringify(fixture));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.phases).toHaveLength(0);
  });

  it("preserves label for default-type agents (no agentType override)", async () => {
    const filePath = path.join(tmpDir, "wf_generic.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    // All agents come through with their wf label intact
    expect(result!.agents[0].label).toBe("find:A-arialabel");
  });

  it("returns null for garbage file content", async () => {
    const filePath = path.join(tmpDir, "wf_garbage.json");
    await fs.writeFile(filePath, "not { valid json");
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).toBeNull();
  });

  it("returns null when runId is missing", async () => {
    const { runId: _r, ...withoutRunId } = FULL_FIXTURE;
    const filePath = path.join(tmpDir, "wf_norunid.json");
    await fs.writeFile(filePath, JSON.stringify(withoutRunId));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).toBeNull();
  });
});

describe("scanWorkflows", () => {
  it("returns empty array when workflows dir does not exist", async () => {
    const result = await scanWorkflows(tmpDir, "no-such-session");
    expect(result).toEqual([]);
  });

  it("returns parsed runs for wf_*.json files", async () => {
    const sessionId = "sess-xyz";
    const wfDir = path.join(tmpDir, sessionId, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "wf_run1.json"), JSON.stringify(FULL_FIXTURE));
    await fs.writeFile(
      path.join(wfDir, "wf_run2.json"),
      JSON.stringify({ ...FULL_FIXTURE, runId: "wf_run2", workflowName: "other-flow" }),
    );
    // Non-matching file should be ignored
    await fs.writeFile(path.join(wfDir, "notaworkflow.json"), JSON.stringify(FULL_FIXTURE));

    const result = await scanWorkflows(tmpDir, sessionId);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.runId).sort();
    expect(ids).toContain("wf_1abd6ed8-fdb");
    expect(ids).toContain("wf_run2");
  });

  it("drops null results from garbage files", async () => {
    const sessionId = "sess-garbage";
    const wfDir = path.join(tmpDir, sessionId, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "wf_ok.json"), JSON.stringify(FULL_FIXTURE));
    await fs.writeFile(path.join(wfDir, "wf_bad.json"), "garbage");

    const result = await scanWorkflows(tmpDir, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("wf_1abd6ed8-fdb");
  });
});
```

- [ ] Run the new tests to confirm they fail (module does not exist):
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run scripts/lib/__tests__/workflow-scan.test.ts
  ```
  Expected: all tests fail with "Cannot find module".

- [ ] Create `scripts/lib/workflow-scan.ts`:

```typescript
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowRunState, WorkflowAgentRef, WorkflowPhase, WorkflowStatus } from "../../src/lib/types";

/**
 * Parse a single wf_*.json file into a WorkflowRunState.
 * Returns null on any parse error or missing required fields.
 * Numeric fields in workflowProgress entries are stored as strings in the
 * file format — coerce them via Number().
 */
export function parseWorkflowFile(filePath: string, sessionId: string): WorkflowRunState | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (!data || typeof data !== "object") return null;
    if (typeof data.runId !== "string" || !data.runId) return null;

    const status: WorkflowStatus =
      data.status === "completed" || data.status === "failed"
        ? (data.status as WorkflowStatus)
        : "running";

    const rawPhases = Array.isArray(data.phases) ? data.phases : [];
    const phases: WorkflowPhase[] = rawPhases.map((p: unknown, i: number) => {
      const phase = p as Record<string, unknown>;
      return {
        index: i + 1,
        title: typeof phase.title === "string" ? phase.title : "",
        ...(typeof phase.detail === "string" ? { detail: phase.detail } : {}),
      };
    });

    const rawProgress = Array.isArray(data.workflowProgress) ? data.workflowProgress : [];
    const agents: WorkflowAgentRef[] = rawProgress
      .filter((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        return e.type === "workflow_agent" && typeof e.agentId === "string";
      })
      .map((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        const ref: WorkflowAgentRef = {
          agentId: e.agentId as string,
          label: typeof e.label === "string" ? e.label : (e.agentId as string),
          state: typeof e.state === "string" ? e.state : "unknown",
        };
        if (e.phaseIndex !== undefined) ref.phaseIndex = Number(e.phaseIndex);
        if (e.phaseTitle !== undefined) ref.phaseTitle = String(e.phaseTitle);
        if (e.model !== undefined) ref.model = String(e.model);
        if (e.tokens !== undefined) ref.tokens = Number(e.tokens);
        if (e.toolCalls !== undefined) ref.toolCalls = Number(e.toolCalls);
        if (e.durationMs !== undefined) ref.durationMs = Number(e.durationMs);
        return ref;
      });

    const run: WorkflowRunState = {
      runId: data.runId as string,
      sessionId,
      name: typeof data.workflowName === "string" ? data.workflowName : (data.runId as string),
      status,
      startTime: typeof data.startTime === "number" ? data.startTime : 0,
      agentCount: typeof data.agentCount === "number" ? data.agentCount : agents.length,
      phases,
      agents,
    };

    if (typeof data.durationMs === "number") run.durationMs = data.durationMs;
    if (typeof data.totalTokens === "number") run.totalTokens = data.totalTokens;
    if (typeof data.totalToolCalls === "number") run.totalToolCalls = data.totalToolCalls;
    if (typeof data.summary === "string") run.summary = data.summary;

    return run;
  } catch {
    return null;
  }
}

/**
 * Read <projectPath>/<sessionId>/workflows/wf_*.json and parse each.
 * Drops null results from unparseable files.
 */
export async function scanWorkflows(projectPath: string, sessionId: string): Promise<WorkflowRunState[]> {
  const wfDir = path.join(projectPath, sessionId, "workflows");
  let files: string[];
  try {
    files = await fsp.readdir(wfDir);
  } catch {
    return [];
  }

  const results: WorkflowRunState[] = [];
  for (const file of files) {
    if (!file.startsWith("wf_") || !file.endsWith(".json")) continue;
    const filePath = path.join(wfDir, file);
    const run = parseWorkflowFile(filePath, sessionId);
    if (run !== null) results.push(run);
  }
  return results;
}
```

- [ ] Run the scanner tests to confirm all pass:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run scripts/lib/__tests__/workflow-scan.test.ts
  ```
  Expected: all tests pass.

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add scripts/lib/workflow-scan.ts scripts/lib/__tests__/workflow-scan.test.ts && git commit -m "feat(scanner): add parseWorkflowFile and scanWorkflows for wf_*.json discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Backend state — add workflows singleton and upsert/remove helpers

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/agent-state.ts` (lines 1, 10, 28-47)

- [ ] In `scripts/lib/agent-state.ts`, add `WorkflowRunState` to the import from `../../src/lib/types` (line 1):

```typescript
import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  TeamState,
  ThinkingEffort,
  ToolCallEntry,
  WorkflowRunState,
} from "../../src/lib/types";
```

- [ ] Extend the `declare global` block (lines 28-37) to include `workflows`:

```typescript
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorState: {
    agents: Map<string, AgentState>;
    edges: EdgeState[];
    teams: Map<string, TeamState>;
    workflows: Map<string, WorkflowRunState>;
    agentLastModified: Map<string, number>;
    removedAgentIds: Map<string, number>;
    agentFilePaths: Map<string, string>;
    started: boolean;
  } | undefined;
}
```

- [ ] Extend the `??=` initializer (lines 39-47) to include `workflows`:

```typescript
const store = (globalThis.__agentMonitorState ??= {
  agents: new Map<string, AgentState>(),
  edges: [] as EdgeState[],
  teams: new Map<string, TeamState>(),
  workflows: new Map<string, WorkflowRunState>(),
  agentLastModified: new Map<string, number>(),
  removedAgentIds: new Map<string, number>(),
  agentFilePaths: new Map<string, string>(),
  started: false,
});
```

- [ ] After the existing `export const agentFilePaths = store.agentFilePaths;` line (~line 54), add:

```typescript
export const workflows = store.workflows;

export function upsertWorkflow(run: WorkflowRunState): void {
  workflows.set(run.runId, run);
  broadcast({ type: "workflow:update", workflow: run });
}

export function removeWorkflow(runId: string): void {
  workflows.delete(runId);
  broadcast({ type: "workflow:remove", runId });
}
```

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Run the existing agent-state tests to confirm no regressions:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run scripts/lib/__tests__/agent-state.test.ts scripts/lib/__tests__/agent-state.hmr.test.ts
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add scripts/lib/agent-state.ts && git commit -m "feat(state): add workflows Map and upsertWorkflow/removeWorkflow to singleton store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Discovery integration — scan workflows per session, prune on eviction

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/discovery.ts` (import block ~line 18; after `updateAgentStatus` calls ~line 298; both eviction loops ~lines 467-492 and 495-521)

- [ ] Add imports at the top of `scripts/lib/discovery.ts`. After the existing imports block, add:

```typescript
import { scanWorkflows } from "./workflow-scan";
import { workflows, upsertWorkflow, removeWorkflow } from "./agent-state";
```

- [ ] Add a module-level content-hash map just before the `UUID_RE` constant (line ~74):

```typescript
// Content-hash cache: avoids re-broadcasting workflow runs that haven't changed.
const wfContentCache = new Map<string, string>();
```

- [ ] Insert "Step 1.5" inside the `for (const mainJsonl of mainJsonlFiles)` loop, immediately after the `updateAgentStatus(sessionId, stat.mtimeMs);` call at line ~298. The insertion must remain inside the loop and have access to `projectPath` and `sessionId`:

```typescript
      // ── Step 1.5: Discover workflow runs for this session ──
      {
        const runs = await scanWorkflows(projectPath, sessionId);
        for (const run of runs) {
          const hash = JSON.stringify(run);
          if (wfContentCache.get(run.runId) !== hash) {
            wfContentCache.set(run.runId, hash);
            upsertWorkflow(run);
          }
        }
      }
```

- [ ] In the `selectLosingMains` eviction loop (lines ~467-492), after each `broadcast({ type: "state:remove", agentId });` call, add workflow pruning for losing mains. The eviction loop processes `losingIds`; only mains have `!agent.parentId`. Add this block inside the `for (const agentId of losingIds)` loop, after the existing broadcast:

```typescript
    // Prune workflows belonging to this main session
    if (!agents.get(agentId)?.parentId) {
      for (const [runId, run] of workflows) {
        if (run.sessionId === agentId) {
          wfContentCache.delete(runId);
          removeWorkflow(runId);
        }
      }
    }
```

  Note: `agents.get(agentId)` is read before `agents.delete(agentId)` — reorder if needed so the agent lookup happens before deletion. Looking at the actual loop structure in `discoverActiveSessions`: the loop deletes `agents` first at line ~470. Move the parentId check to use the already-captured `agent` variable that is set at line ~469:

```typescript
    // Before agents.delete(agentId) is called, agent is captured:
    // const agent = agents.get(agentId);  ← already on line ~469
    // After broadcast, add:
    if (agent && !agent.parentId) {
      for (const [runId, run] of workflows) {
        if (run.sessionId === agentId) {
          wfContentCache.delete(runId);
          removeWorkflow(runId);
        }
      }
    }
```

- [ ] Apply the identical workflow pruning block inside the `selectStaleAgentIds` eviction loop (lines ~495-521). The stale loop also has `const agent = agents.get(agentId);` at its top. After the existing broadcast call:

```typescript
    if (agent && !agent.parentId) {
      for (const [runId, run] of workflows) {
        if (run.sessionId === agentId) {
          wfContentCache.delete(runId);
          removeWorkflow(runId);
        }
      }
    }
```

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Run the discovery tests to confirm no regressions:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run scripts/lib/__tests__/discovery.test.ts
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add scripts/lib/discovery.ts && git commit -m "feat(discovery): scan wf_*.json per session (Step 1.5) and prune on main eviction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Stream route and SSE hook — wire workflows to clients

> **Execute Task 7 (store) before this task.** The SSE hook here consumes the store methods (`syncState` 4th arg, `upsertWorkflow`, `removeWorkflow`) added in Task 7, and Task 7 has no dependency on this task. Running 7→6 keeps the repo green and typecheck clean at every commit. (If you run in numeric order instead, expect a transient typecheck error here, resolved by Task 7.)

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/app/api/stream/route.ts` (line 1 imports; line 56-62 syncEvent)
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/hooks/useEventStream.ts` (line 85; add two new cases)

- [ ] In `src/app/api/stream/route.ts`, add `workflows` to the import from `agent-state` (line 6):

```typescript
import {
  agents,
  edges,
  teams,
  workflows,
  viewers,
} from "../../../../scripts/lib/agent-state";
```

- [ ] In `src/app/api/stream/route.ts`, update the `syncEvent` construction (line ~56-62) to include `workflows`:

```typescript
        const syncEvent: ServerEvent = {
          type: "state:sync",
          agents: Array.from(agents.values()),
          edges: [...edges],
          teams: Array.from(teams.values()),
          workflows: Array.from(workflows.values()),
          protocolVersion: PROTOCOL_VERSION,
        };
```

- [ ] In `src/hooks/useEventStream.ts`, update the `state:sync` case (line ~85) to pass workflows as the 4th argument:

```typescript
        case "state:sync":
          if (!protocolWarned && event.protocolVersion !== PROTOCOL_VERSION) {
            console.warn(
              `Stream protocol version mismatch: server=${event.protocolVersion ?? "unset"}, client=${PROTOCOL_VERSION}. Continuing.`,
            );
            protocolWarned = true;
          }
          if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
          eventBuffer = [];
          if (!replayActive) store.syncState(event.agents, event.edges, event.teams, event.workflows ?? []);
          break;
```

- [ ] In `src/hooks/useEventStream.ts`, add the two new cases to the switch statement after the `annotation:update` case (before the closing brace of the switch):

```typescript
        case "workflow:update":
          if (!replayActive) store.upsertWorkflow(event.workflow);
          break;
        case "workflow:remove":
          if (!replayActive) store.removeWorkflow(event.runId);
          break;
```

- [ ] Run typecheck (clean if Task 7 was done first, as recommended):
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0. (If you ran in numeric order and Task 7 is not yet done, the only errors will be about `syncState`'s 4th arg / `upsertWorkflow` / `removeWorkflow` not existing yet — resolved by Task 7.)

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/app/api/stream/route.ts src/hooks/useEventStream.ts && git commit -m "feat(stream): include workflows in state:sync payload and handle workflow SSE events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Store — add workflows Map, extend syncState, add upsert/remove/select actions

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/types.ts` (lines 50-62 area)
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/agentSlice.ts` (lines 23-29 Pick, line 37 initial state, lines 64-75 syncState)
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/store/uiSlice.ts` (lines 7-24 Pick, line 35 state, line 105 after selectTeam)
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/store-workflows.test.ts`
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/test-utils.ts` (lines 42-50)

- [ ] Write the failing tests first. Create `src/lib/__tests__/store-workflows.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";
import type { WorkflowRunState } from "../types";

function getState() {
  return useAgentStore.getState();
}

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_test-1",
    sessionId: "sess-main",
    name: "test-workflow",
    status: "running",
    startTime: 1000,
    agentCount: 2,
    phases: [{ index: 1, title: "Phase A" }],
    agents: [
      { agentId: "ag-1", label: "find:alpha", state: "done", phaseIndex: 1, phaseTitle: "Phase A" },
      { agentId: "ag-2", label: "verify:beta", state: "running", phaseIndex: 1, phaseTitle: "Phase A" },
    ],
    ...overrides,
  };
}

describe("store – workflow functionality", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      workflows: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
      selectedWorkflowId: null,
      connected: false,
    });
  });

  describe("syncState with workflows", () => {
    it("populates the workflows Map from the 4th arg", () => {
      const run = makeRun();
      getState().syncState([], [], [], [run]);
      const { workflows } = getState();
      expect(workflows.size).toBe(1);
      expect(workflows.get("wf_test-1")).toEqual(run);
    });

    it("replaces existing workflows on re-sync", () => {
      getState().syncState([], [], [], [makeRun({ runId: "wf_old" })]);
      getState().syncState([], [], [], [makeRun({ runId: "wf_new" })]);
      const { workflows } = getState();
      expect(workflows.has("wf_old")).toBe(false);
      expect(workflows.has("wf_new")).toBe(true);
    });

    it("accepts empty workflows array", () => {
      getState().syncState([], [], [], []);
      expect(getState().workflows.size).toBe(0);
    });
  });

  describe("upsertWorkflow", () => {
    it("inserts a new workflow run", () => {
      const run = makeRun();
      getState().upsertWorkflow(run);
      expect(getState().workflows.get("wf_test-1")).toEqual(run);
    });

    it("updates an existing workflow run", () => {
      getState().upsertWorkflow(makeRun({ status: "running" }));
      getState().upsertWorkflow(makeRun({ status: "completed" }));
      expect(getState().workflows.get("wf_test-1")!.status).toBe("completed");
    });
  });

  describe("removeWorkflow", () => {
    it("removes a workflow run by runId", () => {
      getState().upsertWorkflow(makeRun());
      getState().removeWorkflow("wf_test-1");
      expect(getState().workflows.has("wf_test-1")).toBe(false);
    });

    it("is a no-op for unknown runId", () => {
      expect(() => getState().removeWorkflow("wf_nonexistent")).not.toThrow();
    });
  });

  describe("selectWorkflow", () => {
    it("sets selectedWorkflowId", () => {
      getState().selectWorkflow("wf_test-1");
      expect(getState().selectedWorkflowId).toBe("wf_test-1");
    });

    it("clears selectedWorkflowId when set to null", () => {
      getState().selectWorkflow("wf_test-1");
      getState().selectWorkflow(null);
      expect(getState().selectedWorkflowId).toBeNull();
    });
  });
});
```

- [ ] Run the new tests to confirm they fail:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/lib/__tests__/store-workflows.test.ts
  ```
  Expected: all fail (missing workflows/selectedWorkflowId/upsertWorkflow/removeWorkflow/selectWorkflow).

- [ ] Update `src/lib/store/types.ts`. Add `WorkflowRunState` to the import block at the top, then add the four new members to `AgentStore`. The import addition:

```typescript
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  TeamState,
  TeamStats,
  ReplayState,
  ReplaySpeed,
  RecordedSession,
  LogEntry,
  HeatmapMetric,
  ErrorDetail,
  AgentTypeBudgets,
  MetricSample,
  Annotation,
  FileModification,
  ThemeMode,
  GraphLayout,
  ComparisonState,
  AgentType,
  WorkflowRunState,
} from "../types";
```

  After the `teams: Map<string, TeamState>;` line (~50) in `AgentStore`, add:
```typescript
  workflows: Map<string, WorkflowRunState>;
  selectedWorkflowId: string | null;
```

  Change the `syncState` signature (line ~62):
```typescript
  syncState: (agents: AgentState[], edges: EdgeState[], teams: TeamState[], workflows?: WorkflowRunState[]) => void;
```

  After `selectTeam: (teamId: string | null) => void;` (~line 61) add:
```typescript
  selectWorkflow: (runId: string | null) => void;
  upsertWorkflow: (run: WorkflowRunState) => void;
  removeWorkflow: (runId: string) => void;
```

- [ ] Update `src/lib/store/agentSlice.ts`. Extend the `AgentSlice` Pick to include `workflows`, `upsertWorkflow`, `removeWorkflow`:

```typescript
export type AgentSlice = Pick<AgentStore,
  | "agents" | "edges" | "activity" | "nextActivityId" | "topologyVersion" | "teams" | "workflows" | "connected" | "recording" | "recordedEvents"
  | "setConnected" | "syncState" | "handleEvent" | "removeAgent" | "getTeamStats"
  | "upsertWorkflow" | "removeWorkflow"
  | "startRecording" | "downloadRecording"
  | "errorDetails" | "setErrorDetail"
  | "agentTypeBudgets" | "setAgentTypeBudget"
>;
```

  Add `WorkflowRunState` to the import from `"../types"`:
```typescript
import type {
  AgentState,
  TeamState,
  WorkflowRunState,
} from "../types";
```

  Add `workflows: new Map()` to the initial state (after `teams: new Map(),`):
```typescript
  teams: new Map(),
  workflows: new Map(),
```

  Replace the `syncState` function body (lines 64-75):
```typescript
  syncState: (agentsList, edges, teamsList, workflowsList = []) => {
    const agents = new Map<string, AgentState>();
    for (const agent of agentsList) {
      agents.set(agent.id, agent);
    }
    const teams = new Map<string, TeamState>();
    for (const team of teamsList) {
      teams.set(team.id, team);
    }
    const workflows = new Map<string, WorkflowRunState>();
    for (const run of workflowsList) {
      workflows.set(run.runId, run);
    }
    set({ agents, edges, teams, workflows, topologyVersion: get().topologyVersion + 1 });
  },
```

  After the `removeAgent` function, add `upsertWorkflow` and `removeWorkflow` before the `// ── F2` comment. Both bump `topologyVersion` so the topology effect rebuilds and recomputes workflow hull membership (`workflowEntries` is computed once per rebuild). Rebuilds restore prior node positions with low alpha, so this is a smooth settle, not a re-layout jump:
```typescript
  upsertWorkflow: (run) => {
    const workflows = new Map(get().workflows);
    workflows.set(run.runId, run);
    set({ workflows, topologyVersion: get().topologyVersion + 1 });
  },

  removeWorkflow: (runId) => {
    const workflows = new Map(get().workflows);
    if (!workflows.delete(runId)) return;
    set({ workflows, topologyVersion: get().topologyVersion + 1 });
  },
```

- [ ] Update `src/lib/store/uiSlice.ts`. Extend the `UISlice` Pick to include `selectedWorkflowId` and `selectWorkflow`:

```typescript
export type UISlice = Pick<AgentStore,
  | "selectedAgentId" | "selectedTeamId" | "selectedWorkflowId" | "selectedSessionIds"
  | "sessionFilterInitialized"
  | "viewMode" | "hiddenAgentTypes"
  | "transcriptOpen" | "fileAttentionOpen"
  | "heatmapEnabled" | "heatmapMetric"
  | "graphLayout" | "showExportModal" | "showLiveMetrics"
  | "theme" | "soundMuted" | "comparison"
  | "selectAgent" | "selectTeam" | "selectWorkflow" | "toggleSession" | "selectAllSessions"
  | "autoSelectInitialSession"
  | "setViewMode" | "toggleAgentType"
  | "toggleTranscript" | "toggleFileAttention"
  | "toggleHeatmap" | "setHeatmapMetric"
  | "setGraphLayout" | "toggleExportModal" | "toggleLiveMetrics"
  | "toggleTheme" | "toggleSoundMute"
  | "loadComparison" | "exitComparison"
  | "hydrateUI"
>;
```

  In the `createUISlice` initial state (after `selectedTeamId: null,`), add:
```typescript
  selectedWorkflowId: null,
```

  After `selectTeam: (teamId) => set({ selectedTeamId: teamId }),` (line ~105), add:
```typescript
  selectWorkflow: (runId) => set({ selectedWorkflowId: runId }),
```

- [ ] Update `src/lib/__tests__/test-utils.ts` to fix `resetStore`:

```typescript
export function resetStore(): void {
  const store = useAgentStore.getState();
  store.syncState([], [], [], []);
  store.selectAgent(null);
  store.selectTeam(null);
  store.selectWorkflow(null);
  agentCounter = 0;
  teamCounter = 0;
}
```

  Also add a `mockWorkflowRun` helper after `mockTeam`:
```typescript
export function mockWorkflowRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: `wf_test-${Date.now()}`,
    sessionId: "sess-main",
    name: "test-workflow",
    status: "running",
    startTime: Date.now(),
    agentCount: 1,
    phases: [],
    agents: [],
    ...overrides,
  };
}
```

  Add `WorkflowRunState` to the imports:
```typescript
import type { AgentState, TeamState, AgentType, AgentStatus, TeamStatus, WorkflowRunState } from "../types";
```

- [ ] Run the store-workflows tests:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/lib/__tests__/store-workflows.test.ts
  ```
  Expected: all pass.

- [ ] Run the full test suite to check for regressions:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm test
  ```
  Expected: all pass.

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/lib/store/types.ts src/lib/store/agentSlice.ts src/lib/store/uiSlice.ts src/lib/__tests__/store-workflows.test.ts src/lib/__tests__/test-utils.ts && git commit -m "feat(store): add workflows Map, syncState 4th arg, upsertWorkflow/removeWorkflow/selectWorkflow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: WorkflowPanel component

**Files:**
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowPanel.tsx`
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowPanel.test.tsx`

- [ ] Write the failing tests first. Create `src/components/__tests__/WorkflowPanel.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { WorkflowPanel } from "../WorkflowPanel";
import type { WorkflowRunState } from "@/lib/types";

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_test-1",
    sessionId: "sess-main",
    name: "code-review-max",
    status: "completed",
    startTime: Date.now() - 60000,
    agentCount: 3,
    totalTokens: 50000,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe("WorkflowPanel", () => {
  beforeEach(() => {
    useAgentStore.setState({
      workflows: new Map(),
      selectedWorkflowId: null,
    });
  });

  it("returns null when there are no workflow runs", () => {
    const { container } = render(<WorkflowPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders run info when workflows exist", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    expect(screen.getByText("code-review-max")).toBeDefined();
    expect(screen.getByText("Workflows (1)")).toBeDefined();
    expect(screen.getByText("completed")).toBeDefined();
  });

  it("calls selectWorkflow when a run row is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(useAgentStore.getState().selectedWorkflowId).toBe("wf_test-1");
  });

  it("deselects when clicking the already-selected run", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_test-1" });
    render(<WorkflowPanel />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(useAgentStore.getState().selectedWorkflowId).toBeNull();
  });

  it("shows agentCount and totalTokens in the run row", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun({ agentCount: 7, totalTokens: 123456 }));
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    expect(screen.getByText(/7/)).toBeDefined();
    expect(screen.getByText(/123\.5k|123456/)).toBeDefined();
  });
});
```

- [ ] Run the failing tests to confirm:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/components/__tests__/WorkflowPanel.test.tsx
  ```
  Expected: all fail (module not found).

- [ ] Create `src/components/WorkflowPanel.tsx`:

```typescript
"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { formatNumber } from "@/lib/utils";

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  running: "#22d3ee",
  completed: "#4ade80",
  failed: "#ef4444",
};

export function WorkflowPanel() {
  const workflows = useAgentStore((s) => s.workflows);
  const selectedWorkflowId = useAgentStore((s) => s.selectedWorkflowId);
  const selectWorkflow = useAgentStore((s) => s.selectWorkflow);

  if (workflows.size === 0) return null;

  const runList = Array.from(workflows.values());

  return (
    <div
      role="region"
      aria-label="Workflow overview"
      className="flex flex-col"
      style={{
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        className="px-3 py-1.5 text-xs uppercase tracking-wider flex-shrink-0 flex items-center justify-between"
        style={{ color: UI.text.muted, borderBottom: "1px solid var(--color-border)" }}
      >
        <span>Workflows ({runList.length})</span>
      </div>
      <div className="overflow-y-auto custom-scrollbar p-2 space-y-2" style={{ maxHeight: 300 }}>
        {runList.map((run) => {
          const isSelected = run.runId === selectedWorkflowId;
          const statusColor = WORKFLOW_STATUS_COLORS[run.status] ?? UI.text.muted;

          return (
            <button
              key={run.runId}
              type="button"
              className="rounded-md p-2 cursor-pointer transition-colors text-left w-full"
              onClick={() => selectWorkflow(isSelected ? null : run.runId)}
              style={{
                background: isSelected ? `#a855f711` : "transparent",
                border: `1px solid ${isSelected ? "#a855f744" : "var(--color-border)"}`,
              }}
            >
              {/* Run header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
                  />
                  <span className="text-sm font-bold font-mono" style={{ color: "#a855f7" }}>
                    {run.name}
                  </span>
                </div>
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {run.status}
                </span>
              </div>

              {/* Summary */}
              {run.summary && (
                <div className="text-xs mt-1 truncate" style={{ color: UI.text.muted }}>
                  {run.summary}
                </div>
              )}

              {/* Stats row */}
              <div className="flex gap-3 mt-1.5 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  Agents: <span style={{ color: UI.text.secondary }}>{run.agentCount}</span>
                </span>
                {run.totalTokens !== undefined && (
                  <span style={{ color: UI.text.dimmed }}>
                    Tokens: <span style={{ color: "#a855f7" }}>{formatNumber(run.totalTokens)}</span>
                  </span>
                )}
                {run.totalToolCalls !== undefined && (
                  <span style={{ color: UI.text.dimmed }}>
                    Tools: <span style={{ color: UI.text.secondary }}>{run.totalToolCalls}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Run the WorkflowPanel tests:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/components/__tests__/WorkflowPanel.test.tsx
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/components/WorkflowPanel.tsx src/components/__tests__/WorkflowPanel.test.tsx && git commit -m "feat(ui): add WorkflowPanel sidebar component with run list and selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: WorkflowDetail overlay component

**Files:**
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowDetail.tsx`
- Create `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowDetail.test.tsx`

- [ ] Write the failing tests first. Create `src/components/__tests__/WorkflowDetail.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { WorkflowDetail } from "../WorkflowDetail";
import type { WorkflowRunState } from "@/lib/types";

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_detail-1",
    sessionId: "sess-main",
    name: "code-review-max",
    status: "completed",
    startTime: Date.now() - 120000,
    durationMs: 120000,
    agentCount: 2,
    totalTokens: 75000,
    totalToolCalls: 30,
    summary: "A detailed summary",
    phases: [
      { index: 1, title: "Find", detail: "finder agents" },
      { index: 2, title: "Verify", detail: "verifier agents" },
    ],
    agents: [
      { agentId: "ag-1", label: "find:alpha", state: "done", phaseIndex: 1, phaseTitle: "Find", tokens: 40000, toolCalls: 15 },
      { agentId: "ag-2", label: "verify:beta", state: "done", phaseIndex: 2, phaseTitle: "Verify", tokens: 35000, toolCalls: 15 },
    ],
    ...overrides,
  };
}

describe("WorkflowDetail", () => {
  beforeEach(() => {
    useAgentStore.setState({
      workflows: new Map(),
      selectedWorkflowId: null,
      agents: new Map(),
    });
  });

  it("renders nothing when no workflow is selected", () => {
    const { container } = render(<WorkflowDetail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when selectedWorkflowId does not match any run", () => {
    useAgentStore.setState({ selectedWorkflowId: "wf_nonexistent" });
    const { container } = render(<WorkflowDetail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders rollups for the selected run", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("code-review-max")).toBeDefined();
    expect(screen.getByText(/completed/i)).toBeDefined();
    expect(screen.getByText(/75(\.0)?k|75000/)).toBeDefined();
  });

  it("renders per-phase progress bars", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("Find")).toBeDefined();
    expect(screen.getByText("Verify")).toBeDefined();
  });

  it("renders the per-agent table rows", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("find:alpha")).toBeDefined();
    expect(screen.getByText("verify:beta")).toBeDefined();
  });

  it("calls selectAgent when an agent row is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    const agentBtn = screen.getByText("find:alpha");
    fireEvent.click(agentBtn);
    expect(useAgentStore.getState().selectedAgentId).toBe("ag-1");
  });

  it("calls selectWorkflow(null) when close button is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(useAgentStore.getState().selectedWorkflowId).toBeNull();
  });
});
```

- [ ] Run the failing tests to confirm:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/components/__tests__/WorkflowDetail.test.tsx
  ```
  Expected: all fail (module not found).

- [ ] Create `src/components/WorkflowDetail.tsx`:

```typescript
"use client";

import { useAgentStore } from "@/lib/store";
import { UI, STATUS_COLORS } from "@/lib/colors";
import { formatNumber, formatDuration } from "@/lib/utils";
import type { WorkflowAgentRef, WorkflowPhase } from "@/lib/types";

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  running: "#22d3ee",
  completed: "#4ade80",
  failed: "#ef4444",
};

export function WorkflowDetail() {
  const selectedWorkflowId = useAgentStore((s) => s.selectedWorkflowId);
  const workflows = useAgentStore((s) => s.workflows);
  const selectWorkflow = useAgentStore((s) => s.selectWorkflow);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  if (!selectedWorkflowId) return null;
  const run = workflows.get(selectedWorkflowId);
  if (!run) return null;

  const statusColor = WORKFLOW_STATUS_COLORS[run.status] ?? UI.text.muted;

  // Build phase → agents map for progress bars
  const agentsByPhase = new Map<string, WorkflowAgentRef[]>();
  for (const agent of run.agents) {
    const phase = agent.phaseTitle ?? "Unassigned";
    const list = agentsByPhase.get(phase) ?? [];
    list.push(agent);
    agentsByPhase.set(phase, list);
  }

  return (
    <div
      className="fixed bottom-0 right-0 z-50 flex flex-col overflow-hidden rounded-tl-lg"
      style={{
        width: 480,
        maxHeight: "70vh",
        background: "var(--color-panel)",
        border: `1px solid #a855f744`,
        boxShadow: `0 0 30px #a855f722, 0 4px 20px rgba(0,0,0,0.5)`,
        borderRight: "none",
        borderBottom: "none",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: "#a855f7", fontSize: 16 }}>⚙</span>
          <span className="font-mono font-bold text-sm" style={{ color: "#a855f7" }}>
            {run.name}
          </span>
          <span
            className="text-xs capitalize px-1.5 py-0.5 rounded"
            style={{ color: statusColor, background: `${statusColor}22` }}
          >
            {run.status}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close workflow detail"
          onClick={() => selectWorkflow(null)}
          className="text-xs px-2 py-1 rounded"
          style={{ color: UI.text.muted, border: "1px solid var(--color-border)" }}
        >
          Close
        </button>
      </div>

      <div className="overflow-y-auto custom-scrollbar flex-1 p-4 space-y-4">
        {/* Rollups */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-xs" style={{ color: UI.text.dimmed }}>Agents</div>
            <div className="text-lg font-mono font-bold" style={{ color: "#a855f7" }}>{run.agentCount}</div>
          </div>
          {run.durationMs !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Duration</div>
              <div className="text-sm font-mono" style={{ color: UI.text.secondary }}>{formatDuration(run.durationMs)}</div>
            </div>
          )}
          {run.totalTokens !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Tokens</div>
              <div className="text-lg font-mono font-bold" style={{ color: "#a855f7" }}>{formatNumber(run.totalTokens)}</div>
            </div>
          )}
          {run.totalToolCalls !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Tool Calls</div>
              <div className="text-sm font-mono" style={{ color: UI.text.secondary }}>{run.totalToolCalls}</div>
            </div>
          )}
        </div>

        {/* Per-phase progress bars */}
        {run.phases.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: UI.text.muted }}>
              Phases
            </div>
            <div className="space-y-2">
              {run.phases.map((phase: WorkflowPhase) => {
                const phaseAgents = agentsByPhase.get(phase.title) ?? [];
                const doneCount = phaseAgents.filter((a) => a.state === "done").length;
                const total = phaseAgents.length;
                const pct = total > 0 ? (doneCount / total) * 100 : 0;

                return (
                  <div key={phase.index}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: UI.text.secondary }}>{phase.title}</span>
                      <span style={{ color: UI.text.muted }}>{doneCount}/{total}</span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: `#a855f722` }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: "#a855f7" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-agent table */}
        {run.agents.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: UI.text.muted }}>
              Agents
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: UI.text.dimmed }}>
                  <th className="text-left pb-1">Label</th>
                  <th className="text-right pb-1">Tokens</th>
                  <th className="text-right pb-1">State</th>
                </tr>
              </thead>
              <tbody>
                {run.agents.map((agent: WorkflowAgentRef) => {
                  const stateColor =
                    agent.state === "done" ? STATUS_COLORS.completed :
                    agent.state === "running" ? STATUS_COLORS.running :
                    agent.state === "error" ? STATUS_COLORS.error :
                    UI.text.muted;

                  return (
                    <tr key={agent.agentId}>
                      <td className="py-0.5">
                        <button
                          type="button"
                          onClick={() => selectAgent(agent.agentId)}
                          className="hover:underline text-left"
                          style={{ color: "#a855f7" }}
                        >
                          {agent.label}
                        </button>
                      </td>
                      <td className="text-right py-0.5" style={{ color: UI.text.secondary }}>
                        {agent.tokens !== undefined ? formatNumber(agent.tokens) : "—"}
                      </td>
                      <td className="text-right py-0.5 capitalize" style={{ color: stateColor }}>
                        {agent.state}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] Run the WorkflowDetail tests:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npx vitest run src/components/__tests__/WorkflowDetail.test.tsx
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/components/WorkflowDetail.tsx src/components/__tests__/WorkflowDetail.test.tsx && git commit -m "feat(ui): add WorkflowDetail overlay with rollups, phase bars, and agent table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 10: Wire WorkflowPanel and WorkflowDetail into Dashboard

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/Dashboard.tsx` (imports ~lines 17-18; after TeamPanel mount ~line 222; overlays ~lines 239-241)

- [ ] Add the two new imports to `src/components/Dashboard.tsx`. After the `import { TeamPanel } from "./TeamPanel";` line (~line 17), add:

```typescript
import { WorkflowPanel } from "./WorkflowPanel";
import { WorkflowDetail } from "./WorkflowDetail";
```

- [ ] Mount `<WorkflowPanel/>` immediately after the `<TeamPanel/>` ErrorBoundary block (line ~223). The current block is:

```tsx
      <ErrorBoundary>
        <TeamPanel />
      </ErrorBoundary>
```

  Change it to:

```tsx
      <ErrorBoundary>
        <TeamPanel />
      </ErrorBoundary>
      <ErrorBoundary>
        <WorkflowPanel />
      </ErrorBoundary>
```

- [ ] Mount `<WorkflowDetail/>` as a conditional overlay at the bottom alongside `<ErrorDrillDown/>` and `<DiffViewer/>` (lines ~239-241). The current block is:

```tsx
      <ErrorDrillDown />
      <ExportModal />
      <DiffViewer />
```

  Change it to:

```tsx
      <ErrorDrillDown />
      <ExportModal />
      <DiffViewer />
      <WorkflowDetail />
```

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Run the full test suite:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm test
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/components/Dashboard.tsx && git commit -m "feat(dashboard): mount WorkflowPanel and WorkflowDetail overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 11: Topology hulls — workflow cluster rendering in useTopologyEffect

**Files:**
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/AgentGraph/useTopologyEffect.ts` (Options interface ~line 14; function signature ~line 36; after teamClusterGroup ~line 156; teamNodeMap section ~line 227; tick callback ~line 374)
- Modify `/Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/AgentGraph/index.tsx` (store reads ~line 30-46; useTopologyEffect call ~line 61-64)

- [ ] Update the `Options` interface in `useTopologyEffect.ts` to add workflow params (after `selectedTeamId` ~line 21):

```typescript
interface Options {
  filteredAgents: AgentState[];
  edges: EdgeState[];
  agents: Map<string, AgentState>;
  teams: Map<string, TeamState>;
  workflows: Map<string, WorkflowRunState>;
  selectedAgentId: string | null;
  selectedTeamId: string | null;
  selectedWorkflowId: string | null;
  topologyVersion: number;
  selectAgent: (id: string | null) => void;
}
```

  Add `WorkflowRunState` to the import from `@/lib/types`:

```typescript
import type { AgentState, EdgeState, TeamState, WorkflowRunState } from "@/lib/types";
```

- [ ] Destructure the new fields from `opts` in the function body (line ~36):

```typescript
  const { filteredAgents, edges, agents, teams, workflows, selectedAgentId, selectedTeamId, selectedWorkflowId, selectAgent, topologyVersion } = opts;
```

- [ ] After the `teamClusterGroup` append (line ~156):

```typescript
    // Team cluster backgrounds (rendered first so they appear behind everything)
    const teamClusterGroup = canvas.append("g").attr("class", "team-clusters");

    // Workflow cluster backgrounds (behind team clusters and nodes)
    const workflowClusterGroup = canvas.append("g").attr("class", "workflow-clusters");
```

- [ ] After the existing `teamEntries` precomputation block (after line ~244), add the workflow node map:

```typescript
    // Build workflow-to-nodes lookup for cluster rendering.
    // Each run's agents are joined to SimNodes by agentId.
    const agentIdToRunId = new Map<string, string>();
    const agentIdToPhaseTitle = new Map<string, string | undefined>();
    for (const run of workflows.values()) {
      for (const ref of run.agents) {
        agentIdToRunId.set(ref.agentId, run.runId);
        agentIdToPhaseTitle.set(ref.agentId, ref.phaseTitle);
      }
    }

    const workflowNodeMap = new Map<string, SimNode[]>();
    for (const node of nodes) {
      const runId = agentIdToRunId.get(node.id);
      if (runId) {
        const list = workflowNodeMap.get(runId) ?? [];
        list.push(node);
        workflowNodeMap.set(runId, list);
      }
    }
    const workflowEntries = Array.from(workflowNodeMap.entries()).filter(
      ([, ns]) => ns.length >= 2,
    );
```

- [ ] In the tick callback, after the closing `});` of `teamMerged.each(...)` (line ~374), add the workflow hull block:

```typescript
        // Update workflow cluster hulls
        const workflowGroups = workflowClusterGroup
          .selectAll<SVGGElement, [string, SimNode[]]>("g.workflow")
          .data(workflowEntries, (d) => d[0]);
        workflowGroups.exit().remove();
        const workflowEnter = workflowGroups.enter().append("g").attr("class", "workflow");
        workflowEnter.append("path").attr("class", "wf-cluster-shape");
        workflowEnter.append("text").attr("class", "wf-cluster-label")
          .attr("text-anchor", "middle")
          .attr("font-family", "monospace")
          .attr("font-size", 10)
          .attr("font-weight", "bold");
        const workflowMerged = workflowEnter.merge(workflowGroups);

        workflowMerged.each(function ([runId, runNodes]) {
          const g = select(this);
          const points = runNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!] as [number, number]);
          const run = workflows.get(runId);
          const isSelectedWorkflow = runId === selectedWorkflowId;
          const wfColor = "#a855f7";

          let d = "";
          if (points.length === 2) {
            const cx = (points[0][0] + points[1][0]) / 2;
            const cy = (points[0][1] + points[1][1]) / 2;
            const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
            const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
            d = `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`;
          } else {
            const hull = polygonHull(points);
            if (hull) {
              const centroid = polygonCentroid(hull);
              const expanded = hull.map(([x, y]) => {
                const dx = x - centroid[0];
                const dy = y - centroid[1];
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const pad = GRAPH.collideRadius;
                return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
              });
              d = `M${expanded.map((p) => p.join(",")).join("L")}Z`;
            }
          }

          g.select<SVGPathElement>("path.wf-cluster-shape")
            .attr("d", d)
            .attr("fill", `${wfColor}08`)
            .attr("stroke", wfColor)
            .attr("stroke-width", isSelectedWorkflow ? 2 : 1)
            .attr("stroke-opacity", isSelectedWorkflow ? 0.6 : 0.25)
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.wf-cluster-label");
          if (run) {
            let minY = Infinity;
            for (const p of points) if (p[1] < minY) minY = p[1];
            if (minY === Infinity) minY = 0;
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            label
              .attr("x", avgX)
              .attr("y", minY - GRAPH.collideRadius - 8)
              .attr("fill", wfColor)
              .attr("opacity", isSelectedWorkflow ? 0.9 : 0.5)
              .text(`⚙ ${run.name}`);
          } else {
            label.text("");
          }
        });

        // Phase centroid labels inside workflow clusters
        workflowMerged.each(function ([runId, runNodes]) {
          const g = select(this);
          const run = workflows.get(runId);
          if (!run || run.phases.length === 0) return;

          // Group run nodes by phaseTitle
          const nodesByPhase = new Map<string, SimNode[]>();
          for (const node of runNodes) {
            const phaseTitle = agentIdToPhaseTitle.get(node.id);
            if (!phaseTitle) continue;
            const list = nodesByPhase.get(phaseTitle) ?? [];
            list.push(node);
            nodesByPhase.set(phaseTitle, list);
          }

          // Join phase labels
          const phaseData = Array.from(nodesByPhase.entries()).filter(
            ([, ns]) => ns.every((n) => n.x != null && n.y != null),
          );

          const phaseLabels = g.selectAll<SVGTextElement, [string, SimNode[]]>("text.phase-label")
            .data(phaseData, (d) => d[0]);
          phaseLabels.exit().remove();
          phaseLabels.enter().append("text")
            .attr("class", "phase-label")
            .attr("text-anchor", "middle")
            .attr("font-family", "monospace")
            .attr("font-size", 8)
            .merge(phaseLabels)
            .each(function ([phaseTitle, phaseNodes]) {
              const avgX = phaseNodes.reduce((s, n) => s + n.x!, 0) / phaseNodes.length;
              const avgY = phaseNodes.reduce((s, n) => s + n.y!, 0) / phaseNodes.length;
              select(this)
                .attr("x", avgX)
                .attr("y", avgY - 18)
                .attr("fill", "#a855f7")
                .attr("opacity", 0.5)
                .text(phaseTitle);
            });
        });
```

- [ ] In `src/components/AgentGraph/index.tsx`, add workflow store reads after the `selectedTeamId` read (~line 36):

```typescript
  const workflows = useAgentStore((s) => s.workflows);
  const selectedWorkflowId = useAgentStore((s) => s.selectedWorkflowId);
```

- [ ] Update the `useTopologyEffect` call (~line 61-64) to pass the new fields:

```typescript
  useTopologyEffect(refs, {
    filteredAgents, edges, agents, teams, workflows,
    selectedAgentId, selectedTeamId, selectedWorkflowId, topologyVersion, selectAgent,
  });
```

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0.

- [ ] Run the full test suite:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm test
  ```
  Expected: all pass.

- [ ] Commit:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git add src/components/AgentGraph/useTopologyEffect.ts src/components/AgentGraph/index.tsx && git commit -m "feat(topology): add workflow hull clusters and phase centroid labels to D3 graph

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 12: Final verification — full suite and typecheck

- [ ] Run the complete test suite one last time:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm test
  ```
  Expected: all tests pass, zero failures.

- [ ] Run typecheck:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && npm run type-check
  ```
  Expected: exit 0, no errors.

- [ ] Verify all expected new test files exist:
  ```bash
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/__tests__/workflow-scan.test.ts
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/lib/__tests__/store-workflows.test.ts
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowPanel.test.tsx
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/__tests__/WorkflowDetail.test.tsx
  ```
  Expected: all four files present.

- [ ] Verify all expected new source files exist:
  ```bash
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/scripts/lib/workflow-scan.ts
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowPanel.tsx
  ls /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring/src/components/WorkflowDetail.tsx
  ```
  Expected: all three files present.

- [ ] Final commit if any uncommitted changes remain:
  ```bash
  cd /Users/erdos/Github/agents/.claude/worktrees/workflow-monitoring && git status
  ```
  If clean, done. If not: stage and commit with an appropriate message ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.agentId: ab79eff8ce003f680 (use SendMessage with to: 'ab79eff8ce003f680' to continue this agent)
<usage>subagent_tokens: 93695
tool_uses: 26
duration_ms: 387385</usage>