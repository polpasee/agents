import { describe, it, expect } from "vitest";
import type { AgentState } from "../types";
import { getTokenPercent, formatNumber, formatDuration, truncateId } from "../utils";

const mockAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: "test-id",
  agentType: "main",
  status: "running",
  task: "test task",
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  contextWindow: 1000000,
  startTime: Date.now(),
  ...overrides,
});

describe("getTokenPercent", () => {
  it("returns 0 when both token counts are zero", () => {
    const agent = mockAgent({ inputTokens: 0, outputTokens: 0 });
    expect(getTokenPercent(agent)).toBe(0);
  });

  it("returns correct percentage for normal token usage", () => {
    const agent = mockAgent({
      inputTokens: 100000,
      outputTokens: 100000,
      contextWindow: 1000000,
    });
    expect(getTokenPercent(agent)).toBe(20);
  });

  it("returns 100 when tokens equal the context window", () => {
    const agent = mockAgent({
      inputTokens: 600000,
      outputTokens: 400000,
      contextWindow: 1000000,
    });
    expect(getTokenPercent(agent)).toBe(100);
  });

  it("caps at 100 when tokens exceed the context window", () => {
    const agent = mockAgent({
      inputTokens: 800000,
      outputTokens: 400000,
      contextWindow: 1000000,
    });
    expect(getTokenPercent(agent)).toBe(100);
  });

  it("returns 0 when contextWindow is zero", () => {
    const agent = mockAgent({
      inputTokens: 5000,
      outputTokens: 5000,
      contextWindow: 0,
    });
    expect(getTokenPercent(agent)).toBe(0);
  });
});

describe("formatNumber", () => {
  it("returns plain number for values under 1000", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatNumber(1000)).toBe("1.0k");
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(999999)).toBe("1000.0k");
  });

  it("formats millions with M suffix", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(2500000)).toBe("2.5M");
    expect(formatNumber(10000000)).toBe("10.0M");
  });

  it("handles exact boundary at 999", () => {
    expect(formatNumber(999)).toBe("999");
  });

  it("handles exact boundary at 1000", () => {
    expect(formatNumber(1000)).toBe("1.0k");
  });

  it("handles exact boundary at 999999", () => {
    expect(formatNumber(999999)).toBe("1000.0k");
  });

  it("handles exact boundary at 1000000", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
  });
});

describe("formatDuration", () => {
  it("returns 0m 0s for 0 milliseconds", () => {
    expect(formatDuration(0)).toBe("0m 0s");
  });

  it("returns 0m Ns for durations under a minute", () => {
    expect(formatDuration(5000)).toBe("0m 5s");
    expect(formatDuration(59999)).toBe("0m 59s");
  });

  it("returns exact minutes with 0 seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(120000)).toBe("2m 0s");
  });

  it("returns mixed minutes and seconds", () => {
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("handles large values", () => {
    expect(formatDuration(3600000)).toBe("60m 0s");
    expect(formatDuration(7261000)).toBe("121m 1s");
  });
});

describe("truncateId", () => {
  it("truncates to default length of 8", () => {
    expect(truncateId("abcdefghijklmnop")).toBe("abcdefgh");
  });

  it("truncates to a custom length", () => {
    expect(truncateId("abcdefghijklmnop", 4)).toBe("abcd");
  });

  it("returns full string when shorter than the length", () => {
    expect(truncateId("abc")).toBe("abc");
    expect(truncateId("abc", 10)).toBe("abc");
  });

  it("returns empty string for empty input", () => {
    expect(truncateId("")).toBe("");
  });
});
