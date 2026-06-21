import { describe, it, expect } from "vitest";
import {
  totalTokens,
  getTokenPercent,
  formatNumber,
  formatDuration,
  truncateId,
  formatTimestamp,
  formatTimestampShort,
  formatResetTime,
} from "../utils";
import { mockAgent } from "./test-utils";

describe("totalTokens", () => {
  it("sums all four token fields", () => {
    const agent = mockAgent({
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreateTokens: 25,
    });
    expect(totalTokens(agent)).toBe(375);
  });

  it("returns 0 when all fields are zero", () => {
    const agent = mockAgent({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    expect(totalTokens(agent)).toBe(0);
  });

  it("handles agents with only input and output tokens", () => {
    const agent = mockAgent({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    expect(totalTokens(agent)).toBe(1500);
  });

  it("handles agents with only cache tokens", () => {
    const agent = mockAgent({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 300,
      cacheCreateTokens: 700,
    });
    expect(totalTokens(agent)).toBe(1000);
  });
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

describe("formatTimestamp", () => {
  it("formats a timestamp as HH:MM:SS in 24-hour format", () => {
    // 2024-01-15 14:30:45 UTC
    const ts = new Date("2024-01-15T14:30:45Z").getTime();
    const result = formatTimestamp(ts);
    // Should contain the hours, minutes, seconds separated by colons
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("returns a string (not undefined or empty)", () => {
    expect(formatTimestamp(Date.now())).toBeTruthy();
  });
});

describe("formatTimestampShort", () => {
  it("formats a timestamp as HH:MM without seconds", () => {
    const ts = new Date("2024-01-15T14:30:45Z").getTime();
    const result = formatTimestampShort(ts);
    // Should be HH:MM format (no seconds)
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns a string (not undefined or empty)", () => {
    expect(formatTimestampShort(Date.now())).toBeTruthy();
  });
});

describe("formatResetTime", () => {
  it("0ms → '0m'", () => {
    expect(formatResetTime(0)).toBe("0m");
  });

  it("90 minutes → '1hr 30m'", () => {
    expect(formatResetTime(90 * 60 * 1000)).toBe("1hr 30m");
  });

  it("24h rollover → '1d 0hr'", () => {
    expect(formatResetTime(24 * 60 * 60 * 1000)).toBe("1d 0hr");
  });

  it("25h → '1d 1hr'", () => {
    expect(formatResetTime(25 * 60 * 60 * 1000)).toBe("1d 1hr");
  });
});
