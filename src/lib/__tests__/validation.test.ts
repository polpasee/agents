import { describe, it, expect } from "vitest";
import { isValidServerEvent, isValidAgentEvent } from "../validation";

describe("isValidServerEvent", () => {
  it("accepts valid state:sync event", () => {
    expect(isValidServerEvent({ type: "state:sync", agents: [], edges: [], teams: [] })).toBe(true);
  });

  it("accepts valid state:update event", () => {
    expect(isValidServerEvent({ type: "state:update", event: { type: "agent:register", agentId: "a1", agentType: "main", task: "do stuff" }, timestamp: Date.now() })).toBe(true);
  });

  it("accepts valid state:remove event", () => {
    expect(isValidServerEvent({ type: "state:remove", agentId: "a1" })).toBe(true);
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
      isValidServerEvent({ type: "state:sync", agents: [], edges: [], teams: [], protocolVersion: 1 }),
    ).toBe(true);
  });

  it("accepts state:sync without protocolVersion (back-compat)", () => {
    expect(isValidServerEvent({ type: "state:sync", agents: [], edges: [], teams: [] })).toBe(true);
  });

  it("rejects state:sync with non-numeric protocolVersion", () => {
    expect(
      isValidServerEvent({ type: "state:sync", agents: [], edges: [], teams: [], protocolVersion: "1" }),
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

  it("rejects workflow:update whose workflow.status is not a valid union member", () => {
    const bad = { ...validWorkflow, status: "bogus" };
    expect(isValidServerEvent({ type: "workflow:update", workflow: bad })).toBe(false);
  });

  it("accepts workflow:update whose workflow.status is a valid union member", () => {
    const running = { ...validWorkflow, status: "running" };
    expect(isValidServerEvent({ type: "workflow:update", workflow: running })).toBe(true);
  });
});

describe("isValidAgentEvent", () => {
  it("accepts valid agent:register", () => {
    expect(isValidAgentEvent({ type: "agent:register", agentId: "a1", agentType: "main", task: "do stuff" })).toBe(true);
  });

  it("accepts valid agent:status", () => {
    expect(isValidAgentEvent({ type: "agent:status", agentId: "a1", status: "running" })).toBe(true);
  });

  it("accepts valid agent:tool_call", () => {
    expect(isValidAgentEvent({ type: "agent:tool_call", agentId: "a1", tool: "bash" })).toBe(true);
  });

  it("accepts valid agent:tokens", () => {
    expect(isValidAgentEvent({ type: "agent:tokens", agentId: "a1", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 200000 })).toBe(true);
  });

  it("accepts valid agent:message", () => {
    expect(isValidAgentEvent({ type: "agent:message", fromId: "a1", toId: "a2", content: "hello" })).toBe(true);
  });

  it("accepts valid agent:complete", () => {
    expect(isValidAgentEvent({ type: "agent:complete", agentId: "a1", duration: 1000 })).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidAgentEvent(null)).toBe(false);
  });

  it("rejects missing agentId for agent:register", () => {
    expect(isValidAgentEvent({ type: "agent:register", agentType: "main", task: "do stuff" })).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidAgentEvent({ type: "unknown", agentId: "a1" })).toBe(false);
  });

  it("rejects agent:status with non-enum status value", () => {
    expect(isValidAgentEvent({ type: "agent:status", agentId: "a1", status: "pwned" })).toBe(false);
  });

  it("rejects agent:register with non-enum agentType value", () => {
    expect(isValidAgentEvent({ type: "agent:register", agentId: "a1", agentType: "unknown-type", task: "t" })).toBe(false);
  });
});

