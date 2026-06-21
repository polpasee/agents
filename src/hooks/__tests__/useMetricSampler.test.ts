import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useMetricSampler } from "../useMetricSampler";
import { METRIC_SAMPLE_INTERVAL_MS } from "@/lib/config";
import type { AgentState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

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
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ showLiveMetrics: true, agents });

    renderHook(() => useMetricSampler());

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS);

    expect(
      useAgentStore.getState().metricHistory.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("computes costPerMin > 0 when prev.totalCost is 0 and current totalCost > 0", () => {
    // Seed a previous sample with totalCost === 0 (the falsy-zero case)
    useAgentStore.setState({
      showLiveMetrics: true,
      agents: new Map(),
      metricHistory: [
        {
          timestamp: Date.now() - METRIC_SAMPLE_INTERVAL_MS,
          activeCount: 0,
          tokensPerSec: 0,
          costPerMin: 0,
          totalCost: 0,
          totalTokens: 0,
        },
      ],
    });

    // Give the store an agent with real tokens so totalCost > 0 on the next tick
    const agent = mockAgent({
      id: "a1",
      inputTokens: 10_000,
      outputTokens: 5_000,
    });
    useAgentStore.setState({ agents: new Map([["a1", agent]]) });

    renderHook(() => useMetricSampler());
    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS);

    const history = useAgentStore.getState().metricHistory;
    // safe: history has at least 1 element after advancing the timer
    const latest = history[history.length - 1]!;
    expect(latest.costPerMin).toBeGreaterThan(0);
  });

  it("cleanup clears interval on unmount", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ showLiveMetrics: true, agents });

    const { unmount } = renderHook(() => useMetricSampler());

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS);
    const countAfterOneTick = useAgentStore.getState().metricHistory.length;
    expect(countAfterOneTick).toBeGreaterThanOrEqual(1);

    unmount();

    vi.advanceTimersByTime(METRIC_SAMPLE_INTERVAL_MS * 5);
    expect(useAgentStore.getState().metricHistory.length).toBe(
      countAfterOneTick,
    );
  });
});
