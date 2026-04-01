import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionComparison } from "../SessionComparison";
import type { AgentState } from "@/lib/types";

const mockAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: "agent-1",
  agentType: "main",
  status: "completed",
  task: "test task",
  toolCalls: [],
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  contextWindow: 1000000,
  startTime: Date.now(),
  duration: 5000,
  sessionId: "session-a",
  ...overrides,
});

describe("SessionComparison", () => {
  it("renders two panels with metrics", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", sessionId: "session-a" }));
    agents.set("a2", mockAgent({ id: "a2", sessionId: "session-b" }));

    render(
      <SessionComparison
        leftSession="session-a"
        rightSession="session-b"
        agents={agents}
        onExit={() => {}}
      />
    );

    expect(screen.getByText("SESSION COMPARISON")).toBeDefined();
    expect(screen.getByText("SESSION A")).toBeDefined();
    expect(screen.getByText("SESSION B")).toBeDefined();
    // Metric labels should appear in both panels
    expect(screen.getAllByText("Agents").length).toBe(2);
    expect(screen.getAllByText("Tokens").length).toBe(2);
    expect(screen.getAllByText("Cost").length).toBe(2);
    expect(screen.getAllByText("Duration").length).toBe(2);
  });
});
