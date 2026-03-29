import { describe, it, expect } from "vitest";
import { isValidServerEvent, isValidAgentEvent, sanitizeDisplayText } from "../validation";

describe("isValidServerEvent", () => {
  it("accepts valid state:sync event", () => {
    expect(isValidServerEvent({ type: "state:sync", agents: [], edges: [], teams: [] })).toBe(true);
  });

  it("accepts valid state:update event", () => {
    expect(isValidServerEvent({ type: "state:update", event: { type: "agent:register", agentId: "a1", agentType: "orchestrator", task: "do stuff" }, timestamp: Date.now() })).toBe(true);
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
});

describe("isValidAgentEvent", () => {
  it("accepts valid agent:register", () => {
    expect(isValidAgentEvent({ type: "agent:register", agentId: "a1", agentType: "orchestrator", task: "do stuff" })).toBe(true);
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
    expect(isValidAgentEvent({ type: "agent:register", agentType: "orchestrator", task: "do stuff" })).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidAgentEvent({ type: "unknown", agentId: "a1" })).toBe(false);
  });
});

describe("sanitizeDisplayText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeDisplayText("<b>hello</b>")).toBe("hello");
  });

  it("truncates long text", () => {
    const long = "a".repeat(600);
    expect(sanitizeDisplayText(long)).toHaveLength(500);
  });

  it("respects custom maxLength", () => {
    expect(sanitizeDisplayText("abcdef", 3)).toBe("abc");
  });

  it("handles empty string", () => {
    expect(sanitizeDisplayText("")).toBe("");
  });

  it("strips nested tags", () => {
    expect(sanitizeDisplayText("<div><span>text</span></div>")).toBe("text");
  });
});
