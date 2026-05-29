import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionComparison, formatDelta } from "../SessionComparison";
import type { AgentState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("formatDelta", () => {
  const fmt = (n: number) => String(n);

  it("returns '=' when values are equal", () => {
    expect(formatDelta(5, 5, fmt)).toBe("=");
  });

  it("returns a string starting with '+' when a > b", () => {
    expect(formatDelta(2000, 1000, fmt)).toMatch(/^\+/);
  });

  it("returns a string starting with '-' when a < b", () => {
    expect(formatDelta(1000, 2000, fmt)).toMatch(/^-/);
  });

  it("uses Math.abs for the magnitude (no double-negative)", () => {
    const result = formatDelta(1000, 2000, fmt);
    expect(result).toBe("-1000");
  });
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
