import { describe, it, expect } from "vitest";
import { isValidServerEvent, isValidAgentEvent } from "../validation";

describe("isValidServerEvent", () => {
  it("accepts valid state:sync event", () => {
    expect(
      isValidServerEvent({
        type: "state:sync",
        agents: [],
        edges: [],
        teams: [],
      }),
    ).toBe(true);
  });

  it("accepts valid state:update event", () => {
    expect(
      isValidServerEvent({
        type: "state:update",
        event: {
          type: "agent:register",
          agentId: "a1",
          agentType: "main",
          task: "do stuff",
        },
        timestamp: Date.now(),
      }),
    ).toBe(true);
  });

  it("accepts valid state:remove event", () => {
    expect(isValidServerEvent({ type: "state:remove", agentId: "a1" })).toBe(
      true,
    );
  });

  it("rejects null", () => {
    expect(isValidServerEvent(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidServerEvent("string")).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidServerEvent({ type: "unknown" })).toBe(false);
  });

  it("rejects state:sync without agents", () => {
    expect(isValidServerEvent({ type: "state:sync" })).toBe(false);
  });

  it("rejects state:update without event", () => {
    expect(isValidServerEvent({ type: "state:update" })).toBe(false);
  });

  it("rejects state:remove without agentId", () => {
    expect(isValidServerEvent({ type: "state:remove" })).toBe(false);
  });

  it("accepts state:sync with protocolVersion", () => {
    expect(
      isValidServerEvent({
        type: "state:sync",
        agents: [],
        edges: [],
        teams: [],
        protocolVersion: 1,
      }),
    ).toBe(true);
  });

  it("accepts state:sync without protocolVersion (back-compat)", () => {
    expect(
      isValidServerEvent({
        type: "state:sync",
        agents: [],
        edges: [],
        teams: [],
      }),
    ).toBe(true);
  });

  it("rejects state:sync with non-numeric protocolVersion", () => {
    expect(
      isValidServerEvent({
        type: "state:sync",
        agents: [],
        edges: [],
        teams: [],
        protocolVersion: "1",
      }),
    ).toBe(false);
  });
});

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
    expect(
      isValidServerEvent({ type: "workflow:update", workflow: validWorkflow }),
    ).toBe(true);
  });

  it("rejects workflow:update with missing runId", () => {
    const bad = { ...validWorkflow, runId: undefined };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects workflow:update with missing workflow field", () => {
    expect(isValidServerEvent({ type: "workflow:update" })).toBe(false);
  });

  it("accepts workflow:remove with string runId", () => {
    expect(
      isValidServerEvent({ type: "workflow:remove", runId: "wf_abc" }),
    ).toBe(true);
  });

  it("rejects workflow:remove without runId", () => {
    expect(isValidServerEvent({ type: "workflow:remove" })).toBe(false);
  });

  it("rejects workflow:remove with non-string runId", () => {
    expect(isValidServerEvent({ type: "workflow:remove", runId: 42 })).toBe(
      false,
    );
  });

  it("rejects workflow:update whose workflow.status is not a valid union member", () => {
    const bad = { ...validWorkflow, status: "bogus" };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("accepts workflow:update whose workflow.status is a valid union member", () => {
    const running = { ...validWorkflow, status: "running" };
    expect(
      isValidServerEvent({ type: "workflow:update", workflow: running }),
    ).toBe(true);
  });
});

describe("isValidAgentEvent", () => {
  it("accepts valid agent:register", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "main",
        task: "do stuff",
      }),
    ).toBe(true);
  });

  it("accepts valid agent:status", () => {
    expect(
      isValidAgentEvent({
        type: "agent:status",
        agentId: "a1",
        status: "running",
      }),
    ).toBe(true);
  });

  it("accepts valid agent:tool_call", () => {
    expect(
      isValidAgentEvent({
        type: "agent:tool_call",
        agentId: "a1",
        tool: "bash",
      }),
    ).toBe(true);
  });

  it("accepts valid agent:tokens", () => {
    expect(
      isValidAgentEvent({
        type: "agent:tokens",
        agentId: "a1",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      }),
    ).toBe(true);
  });

  it("accepts valid agent:message", () => {
    expect(
      isValidAgentEvent({
        type: "agent:message",
        fromId: "a1",
        toId: "a2",
        content: "hello",
      }),
    ).toBe(true);
  });

  it("accepts valid agent:complete", () => {
    expect(
      isValidAgentEvent({
        type: "agent:complete",
        agentId: "a1",
        duration: 1000,
      }),
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidAgentEvent(null)).toBe(false);
  });

  it("rejects missing agentId for agent:register", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentType: "main",
        task: "do stuff",
      }),
    ).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidAgentEvent({ type: "unknown", agentId: "a1" })).toBe(false);
  });

  it("rejects agent:status with non-enum status value", () => {
    expect(
      isValidAgentEvent({
        type: "agent:status",
        agentId: "a1",
        status: "pwned",
      }),
    ).toBe(false);
  });

  it("rejects agent:register with non-enum agentType value", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "unknown-type",
        task: "t",
      }),
    ).toBe(false);
  });

  it("accepts agent:register with valid optional fields", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "main",
        task: "t",
        effort: "high",
        is1MContext: true,
        parentId: "p1",
        model: "opus",
        displayType: "api-builder",
      }),
    ).toBe(true);
  });

  it("accepts agent:register with absent optional fields", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "main",
        task: "t",
      }),
    ).toBe(true);
  });

  it("rejects agent:register with non-enum effort value", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "main",
        task: "t",
        effort: "turbo",
      }),
    ).toBe(false);
  });

  it("rejects agent:register with non-boolean is1MContext", () => {
    expect(
      isValidAgentEvent({
        type: "agent:register",
        agentId: "a1",
        agentType: "main",
        task: "t",
        is1MContext: "yes",
      }),
    ).toBe(false);
  });
});

// ── 2a: NaN/missing token field guards ──────────────────────────────────────

describe("agent:tokens — NaN / Infinity / missing field rejection (2a)", () => {
  const validTokens = {
    type: "agent:tokens",
    agentId: "a1",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheCreateTokens: 5,
    contextWindow: 200000,
  };

  it("rejects NaN for inputTokens", () => {
    expect(isValidAgentEvent({ ...validTokens, inputTokens: NaN })).toBe(false);
  });

  it("rejects NaN for outputTokens", () => {
    expect(isValidAgentEvent({ ...validTokens, outputTokens: NaN })).toBe(
      false,
    );
  });

  it("rejects NaN for cacheReadTokens", () => {
    expect(isValidAgentEvent({ ...validTokens, cacheReadTokens: NaN })).toBe(
      false,
    );
  });

  it("rejects NaN for cacheCreateTokens", () => {
    expect(isValidAgentEvent({ ...validTokens, cacheCreateTokens: NaN })).toBe(
      false,
    );
  });

  it("rejects NaN for contextWindow", () => {
    expect(isValidAgentEvent({ ...validTokens, contextWindow: NaN })).toBe(
      false,
    );
  });

  it("rejects Infinity for inputTokens", () => {
    expect(isValidAgentEvent({ ...validTokens, inputTokens: Infinity })).toBe(
      false,
    );
  });

  it("rejects missing outputTokens field", () => {
    const { outputTokens: _o, ...withoutOutput } = validTokens;
    expect(isValidAgentEvent(withoutOutput)).toBe(false);
  });

  it("rejects missing cacheReadTokens field", () => {
    const { cacheReadTokens: _c, ...without } = validTokens;
    expect(isValidAgentEvent(without)).toBe(false);
  });

  it("rejects missing cacheCreateTokens field", () => {
    const { cacheCreateTokens: _c, ...without } = validTokens;
    expect(isValidAgentEvent(without)).toBe(false);
  });

  it("rejects missing contextWindow field", () => {
    const { contextWindow: _c, ...without } = validTokens;
    expect(isValidAgentEvent(without)).toBe(false);
  });

  it("accepts all zero finite values", () => {
    expect(
      isValidAgentEvent({
        ...validTokens,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 0,
      }),
    ).toBe(true);
  });
});

// ── 2c: malformed nested arrays in workflow and annotation validators ────────

describe("isWorkflowRunState — malformed phases/agents elements (2c)", () => {
  const validWorkflow = {
    runId: "wf_abc",
    sessionId: "sess-1",
    name: "code-review",
    status: "completed",
    startTime: 1000,
    agentCount: 1,
    phases: [{ index: 1, title: "Phase 1" }],
    agents: [{ agentId: "a1", label: "reviewer", state: "done" }],
  };

  it("accepts valid phases and agents elements", () => {
    expect(
      isValidServerEvent({ type: "workflow:update", workflow: validWorkflow }),
    ).toBe(true);
  });

  it("rejects phases element missing index", () => {
    const bad = {
      ...validWorkflow,
      phases: [{ title: "Phase 1" }],
    };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects phases element missing title", () => {
    const bad = { ...validWorkflow, phases: [{ index: 1 }] };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects phases element that is a non-object primitive", () => {
    const bad = { ...validWorkflow, phases: ["not-an-object"] };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects agents element missing agentId", () => {
    const bad = {
      ...validWorkflow,
      agents: [{ label: "reviewer", state: "done" }],
    };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects agents element missing label", () => {
    const bad = {
      ...validWorkflow,
      agents: [{ agentId: "a1", state: "done" }],
    };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects agents element missing state", () => {
    const bad = {
      ...validWorkflow,
      agents: [{ agentId: "a1", label: "reviewer" }],
    };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("rejects agents element that is a non-object primitive", () => {
    const bad = { ...validWorkflow, agents: [42] };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(
      false,
    );
  });

  it("accepts empty phases and agents arrays", () => {
    const empty = { ...validWorkflow, phases: [], agents: [], agentCount: 0 };
    expect(
      isValidServerEvent({ type: "workflow:update", workflow: empty }),
    ).toBe(true);
  });
});

describe("isAnnotationShape — full field validation (2c)", () => {
  const validAnnotation = {
    id: "ann-1",
    targetId: "agent-x",
    targetType: "agent",
    text: "a note",
    timestamp: 1000,
  };

  it("accepts annotation:sync with fully-shaped annotation", () => {
    expect(
      isValidServerEvent({
        type: "annotation:sync",
        annotations: [validAnnotation],
      }),
    ).toBe(true);
  });

  it("rejects annotation missing targetType", () => {
    const { targetType: _t, ...without } = validAnnotation;
    expect(
      isValidServerEvent({ type: "annotation:sync", annotations: [without] }),
    ).toBe(false);
  });

  it("rejects annotation with invalid targetType", () => {
    expect(
      isValidServerEvent({
        type: "annotation:sync",
        annotations: [{ ...validAnnotation, targetType: "node" }],
      }),
    ).toBe(false);
  });

  it("rejects annotation missing text", () => {
    const { text: _t, ...without } = validAnnotation;
    expect(
      isValidServerEvent({ type: "annotation:sync", annotations: [without] }),
    ).toBe(false);
  });

  it("rejects annotation missing timestamp", () => {
    const { timestamp: _t, ...without } = validAnnotation;
    expect(
      isValidServerEvent({ type: "annotation:sync", annotations: [without] }),
    ).toBe(false);
  });

  it("rejects annotation:update with annotation missing text field", () => {
    const { text: _t, ...without } = validAnnotation;
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: without,
        action: "add",
      }),
    ).toBe(false);
  });
});
