import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useMetricSampler } from "../useMetricSampler";
import { METRIC_SAMPLE_INTERVAL_MS } from "@/lib/config";
import type { AgentState } from "@/lib/types";

function mockAgent(id: string, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id,
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1000000,
    startTime: Date.now(),
    ...overrides,
  };
}

describe("useMetricSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAgentStore.setState({
      showLiveMetrics: false,
      metricHistory: [],
      agents: new Map(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when showLiveMetrics is false", () => {
    useAgentStore.setState({ showLiveMetrics: false });

    renderHook(() => useMetricSampler());

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS * 3);

    expect(useAgentStore.getState().metricHistory).toHaveLength(0);
  });

  it("starts interval when showLiveMetrics is true", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1"));
    useAgentStore.setState({ showLiveMetrics: true, agents });

    renderHook(() => useMetricSampler());

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS);

    expect(useAgentStore.getState().metricHistory.length).toBeGreaterThanOrEqual(1);
  });

  it("cleanup clears interval on unmount", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1"));
    useAgentStore.setState({ showLiveMetrics: true, agents });

    const { unmount } = renderHook(() => useMetricSampler());

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS);
    const countAfterOneTick = useAgentStore.getState().metricHistory.length;
    expect(countAfterOneTick).toBeGreaterThanOrEqual(1);

    unmount();

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS * 5);
    expect(useAgentStore.getState().metricHistory.length).toBe(countAfterOneTick);
  });
});
