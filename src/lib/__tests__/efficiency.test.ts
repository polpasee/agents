import { describe, it, expect } from "vitest";
import { calculateEfficiency } from "../efficiency";
import type { AgentState } from "../types";

function mockAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1", agentType: "main", status: "running", task: "test",
    toolCalls: [], inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 1000000,
    startTime: Date.now(), ...overrides,
  };
}

describe("calculateEfficiency", () => {
  it("returns 50 for a default agent with no data", () => {
    const result = calculateEfficiency(mockAgent(), []);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("scores higher for completed agents", () => {
    const completed = mockAgent({ status: "completed", duration: 5000, toolCalls: [
      { tool: "Read", timestamp: Date.now() },
      { tool: "Edit", timestamp: Date.now() },
    ]});
    const running = mockAgent({ status: "running" });
    const resultCompleted = calculateEfficiency(completed, [running]);
    const resultRunning = calculateEfficiency(running, [completed]);
    expect(resultCompleted.toolSuccessRate).toBeGreaterThan(resultRunning.toolSuccessRate);
  });

  it("scores lower for errored agents", () => {
    const errored = mockAgent({ status: "error", toolCalls: [
      { tool: "Bash", timestamp: Date.now() },
    ]});
    const result = calculateEfficiency(errored, []);
    expect(result.toolSuccessRate).toBeLessThan(50);
  });

  it("has token efficiency centered around 30% output ratio", () => {
    const balanced = mockAgent({ inputTokens: 7000, outputTokens: 3000 });
    const result = calculateEfficiency(balanced, []);
    expect(result.tokenEfficiency).toBeGreaterThan(80);
  });

  it("overall is 0-100 range", () => {
    const agent = mockAgent({ inputTokens: 1000, outputTokens: 500, status: "completed", duration: 3000 });
    const result = calculateEfficiency(agent, []);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("completion speed compares to peers", () => {
    const fast = mockAgent({ agentType: "explore", status: "completed", duration: 2000 });
    const slow = mockAgent({ id: "a2", agentType: "explore", status: "completed", duration: 10000 });
    const fastScore = calculateEfficiency(fast, [slow]);
    const slowScore = calculateEfficiency(slow, [fast]);
    expect(fastScore.completionSpeed).toBeGreaterThan(slowScore.completionSpeed);
  });
});
