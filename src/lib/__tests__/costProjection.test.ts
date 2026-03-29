import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateBurnRate, calculateProjection } from "../costProjection";
import type { ActivityEntry, AgentState } from "../types";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    agentType: "build",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: 0,
    ...overrides,
  };
}

describe("calculateBurnRate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when no agents exist", () => {
    const agents = new Map<string, AgentState>();
    const rate = calculateBurnRate([], agents);
    expect(rate).toBe(0);
  });

  it("returns 0 with fewer than 2 token events", () => {
    vi.setSystemTime(60_000);
    const agent = makeAgent({ id: "a1", inputTokens: 5000, outputTokens: 2000, startTime: 0 });
    const agents = new Map([["a1", agent]]);

    const activity: ActivityEntry[] = [
      {
        id: "act-1",
        timestamp: 30_000,
        event: {
          type: "agent:tokens",
          agentId: "a1",
          inputTokens: 5000,
          outputTokens: 2000,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 200000,
        },
      },
    ];

    const rate = calculateBurnRate(activity, agents);
    expect(rate).toBe(0);
  });

  it("returns a positive rate with agents that have tokens and multiple events", () => {
    const now = 120_000;
    vi.setSystemTime(now);

    const agent = makeAgent({
      id: "a1",
      inputTokens: 100_000,
      outputTokens: 50_000,
      startTime: 0,
    });
    const agents = new Map([["a1", agent]]);

    const activity: ActivityEntry[] = [
      {
        id: "act-1",
        timestamp: now - 30_000,
        event: {
          type: "agent:tokens",
          agentId: "a1",
          inputTokens: 50_000,
          outputTokens: 25_000,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 200000,
        },
      },
      {
        id: "act-2",
        timestamp: now - 10_000,
        event: {
          type: "agent:tokens",
          agentId: "a1",
          inputTokens: 100_000,
          outputTokens: 50_000,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 200000,
        },
      },
    ];

    const rate = calculateBurnRate(activity, agents);
    expect(rate).toBeGreaterThan(0);
  });
});

describe("calculateProjection", () => {
  it("with no budget returns Infinity timeToThreshold", () => {
    const result = calculateProjection(1.5, 0.1, null, 60_000);
    expect(result.timeToThreshold).toBe(Infinity);
    expect(result.percentOfBudget).toBe(0);
  });

  it("with budget calculates correct percentOfBudget", () => {
    const currentTotal = 5.0;
    const budget = 10.0;
    const result = calculateProjection(currentTotal, 0.1, budget, 60_000);
    expect(result.percentOfBudget).toBe(50); // 5/10 * 100
  });

  it("with budget and burn rate calculates timeToThreshold", () => {
    const currentTotal = 2.0;
    const burnRate = 0.5; // $0.50/min
    const budget = 10.0;
    const result = calculateProjection(currentTotal, burnRate, budget, 60_000);

    // timeToThreshold = (10 - 2) / 0.5 = 16 minutes
    expect(result.timeToThreshold).toBe(16);
    expect(result.percentOfBudget).toBe(20);
    expect(result.burnRate).toBe(0.5);
  });

  it("with zero burn rate and under budget returns Infinity timeToThreshold", () => {
    const result = calculateProjection(2.0, 0, 10.0, 60_000);
    expect(result.timeToThreshold).toBe(Infinity);
    expect(result.projectedTotal).toBe(2.0);
  });

  it("with current total exceeding budget returns timeToThreshold=0", () => {
    const result = calculateProjection(12.0, 0.5, 10.0, 60_000);
    expect(result.timeToThreshold).toBe(0);
    expect(result.percentOfBudget).toBe(120);
  });

  it("calculates projectedTotal with burn rate", () => {
    const burnRate = 1.0; // $1/min
    const elapsedMs = 120_000; // 2 minutes
    const result = calculateProjection(5.0, burnRate, null, elapsedMs);
    // projectedTotal = 5 + 1 * 2 = 7
    expect(result.projectedTotal).toBe(7);
  });
});
