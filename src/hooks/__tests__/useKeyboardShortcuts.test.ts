import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";
import type { AgentState } from "@/lib/types";

function mockAgent(id: string, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id,
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1000000,
    startTime: Date.now(),
    ...overrides,
  };
}

describe("useKeyboardShortcuts", () => {
  const graphRef = { current: { fitToView: vi.fn() } };

  beforeEach(() => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1"));
    agents.set("a2", mockAgent("a2"));
    agents.set("a3", mockAgent("a3"));
    useAgentStore.setState({
      agents,
      selectedAgentId: null,
    });
    graphRef.current.fitToView.mockClear();
  });

  it("Escape clears selectedAgentId", () => {
    useAgentStore.setState({ selectedAgentId: "a1" });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useAgentStore.getState().selectedAgentId).toBeNull();
  });

  it("ArrowDown selects next agent", () => {
    useAgentStore.setState({ selectedAgentId: "a1" });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(useAgentStore.getState().selectedAgentId).toBe("a2");
  });

  it("ArrowUp selects previous agent", () => {
    useAgentStore.setState({ selectedAgentId: "a2" });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));

    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("ArrowDown wraps around to first agent", () => {
    useAgentStore.setState({ selectedAgentId: "a3" });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("ArrowUp wraps around to last agent", () => {
    useAgentStore.setState({ selectedAgentId: "a1" });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));

    expect(useAgentStore.getState().selectedAgentId).toBe("a3");
  });

  it("ArrowDown selects first agent when none selected", () => {
    useAgentStore.setState({ selectedAgentId: null });

    renderHook(() => useKeyboardShortcuts(graphRef as any));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });
});
