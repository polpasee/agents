import { describe, it, expect } from "vitest";
import type { AgentState } from "../types";
import { calculateCost, formatCost, calculateTotalCost } from "../costs";
import { mockAgent } from "./test-utils";

describe("calculateCost", () => {
  it("returns all zeros when token counts are zero", () => {
    const agent = mockAgent();
    const cost = calculateCost(agent);
    expect(cost.input).toBe(0);
    expect(cost.output).toBe(0);
    expect(cost.cacheRead).toBe(0);
    expect(cost.cacheWrite).toBe(0);
    expect(cost.total).toBe(0);
  });

  it("uses opus rates for a model containing 'opus'", () => {
    const agent = mockAgent({
      model: "claude-opus-4-20260301",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreateTokens: 1_000_000,
    });
    const cost = calculateCost(agent);
    expect(cost.input).toBeCloseTo(15);
    expect(cost.output).toBeCloseTo(75);
    expect(cost.cacheRead).toBeCloseTo(1.5);
    expect(cost.cacheWrite).toBeCloseTo(18.75);
    expect(cost.total).toBeCloseTo(110.25);
  });

  it("uses sonnet rates for a model containing 'sonnet'", () => {
    const agent = mockAgent({
      model: "claude-sonnet-4-20260301",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreateTokens: 1_000_000,
    });
    const cost = calculateCost(agent);
    expect(cost.input).toBeCloseTo(3);
    expect(cost.output).toBeCloseTo(15);
    expect(cost.cacheRead).toBeCloseTo(0.3);
    expect(cost.cacheWrite).toBeCloseTo(3.75);
    expect(cost.total).toBeCloseTo(22.05);
  });

  it("uses haiku rates for a model containing 'haiku'", () => {
    const agent = mockAgent({
      model: "claude-haiku-3-20250307",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreateTokens: 1_000_000,
    });
    const cost = calculateCost(agent);
    expect(cost.input).toBeCloseTo(0.8);
    expect(cost.output).toBeCloseTo(4);
    expect(cost.cacheRead).toBeCloseTo(0.08);
    expect(cost.cacheWrite).toBeCloseTo(1);
    expect(cost.total).toBeCloseTo(5.88);
  });

  it("defaults to opus rates for an unknown model", () => {
    const agent = mockAgent({
      model: "some-unknown-model",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    const cost = calculateCost(agent);
    expect(cost.input).toBeCloseTo(15);
    expect(cost.output).toBeCloseTo(75);
    expect(cost.total).toBeCloseTo(90);
  });

  it("defaults to opus rates when model field is undefined", () => {
    const agent = mockAgent({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    // model is undefined by default in mockAgent
    const cost = calculateCost(agent);
    expect(cost.input).toBeCloseTo(15);
    expect(cost.output).toBeCloseTo(75);
    expect(cost.total).toBeCloseTo(90);
  });
});

describe("formatCost", () => {
  it("returns '<$0.01' for amounts under a penny", () => {
    expect(formatCost(0.001)).toBe("<$0.01");
    expect(formatCost(0.009)).toBe("<$0.01");
  });

  it("formats small amounts with two decimal places", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(0.5)).toBe("$0.50");
    expect(formatCost(1.23)).toBe("$1.23");
  });

  it("formats large amounts with two decimal places", () => {
    expect(formatCost(100)).toBe("$100.00");
    expect(formatCost(1234.567)).toBe("$1234.57");
  });

  it("returns '<$0.01' for zero", () => {
    expect(formatCost(0)).toBe("<$0.01");
  });
});

describe("calculateTotalCost", () => {
  it("returns all zeros for an empty map", () => {
    const agents = new Map<string, AgentState>();
    const total = calculateTotalCost(agents);
    expect(total.input).toBe(0);
    expect(total.output).toBe(0);
    expect(total.cacheRead).toBe(0);
    expect(total.cacheWrite).toBe(0);
    expect(total.total).toBe(0);
  });

  it("returns the cost of a single agent", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "agent-1",
      mockAgent({
        model: "claude-sonnet-4-20260301",
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    );
    const total = calculateTotalCost(agents);
    // sonnet: input = 3, output = 500k/1M * 15 = 7.5
    expect(total.input).toBeCloseTo(3);
    expect(total.output).toBeCloseTo(7.5);
    expect(total.total).toBeCloseTo(10.5);
  });

  it("sums costs across multiple agents with different models", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "agent-opus",
      mockAgent({
        id: "agent-opus",
        model: "claude-opus-4-20260301",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    );
    agents.set(
      "agent-haiku",
      mockAgent({
        id: "agent-haiku",
        model: "claude-haiku-3-20250307",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    );
    const total = calculateTotalCost(agents);
    // opus input = 15, haiku input = 0.8
    expect(total.input).toBeCloseTo(15.8);
    expect(total.output).toBe(0);
    expect(total.total).toBeCloseTo(15.8);
  });
});
