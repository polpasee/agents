import { describe, it, expect } from "vitest";
import {
  createHeatmapScale,
  computeMetricValue,
  renderHeatmapNode,
  renderHeatmapLegend,
} from "../d3/heatmap";
import type { AgentState, HeatmapMetric } from "../types";

const mockAgent: AgentState = {
  id: "a1",
  agentType: "build",
  status: "running",
  task: "test",
  toolCalls: [
    { tool: "bash", timestamp: 1000 },
    { tool: "read", timestamp: 5000 },
  ],
  inputTokens: 5000,
  outputTokens: 2000,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  contextWindow: 200000,
  startTime: 0,
};

describe("createHeatmapScale", () => {
  it("returns a function", () => {
    const scale = createHeatmapScale();
    expect(typeof scale).toBe("function");
  });

  it("returns green color for 0", () => {
    const scale = createHeatmapScale();
    const color = scale(0);
    // The scale maps 0 to the first color in HEATMAP.colors which is "#00ff88"
    expect(color).toMatch(/rgb\(0, 255, 136\)|#00ff88/i);
  });

  it("returns red color for 1", () => {
    const scale = createHeatmapScale();
    const color = scale(1);
    // The scale maps 1 to the last color in HEATMAP.colors which is "#ff4444"
    expect(color).toMatch(/rgb\(255, 68, 68\)|#ff4444/i);
  });
});

describe("computeMetricValue", () => {
  const allAgents = [mockAgent];

  it("returns a number between 0 and 1 for tokenEfficiency", () => {
    const value = computeMetricValue(mockAgent, "tokenEfficiency", allAgents);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for idleRatio", () => {
    const value = computeMetricValue(mockAgent, "idleRatio", allAgents);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for timeToFirstTool", () => {
    const value = computeMetricValue(mockAgent, "timeToFirstTool", allAgents);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for avgToolLatency", () => {
    const value = computeMetricValue(mockAgent, "avgToolLatency", allAgents);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns 0.5 for tokenEfficiency when agent has no tokens", () => {
    const emptyAgent: AgentState = {
      ...mockAgent,
      inputTokens: 0,
      outputTokens: 0,
    };
    const value = computeMetricValue(emptyAgent, "tokenEfficiency", [emptyAgent]);
    expect(value).toBe(0.5);
  });

  it("returns 1 for timeToFirstTool when agent has no tool calls", () => {
    const noToolAgent: AgentState = {
      ...mockAgent,
      toolCalls: [],
    };
    const value = computeMetricValue(noToolAgent, "timeToFirstTool", [noToolAgent]);
    expect(value).toBe(1);
  });

  it("returns 0.5 for unknown metric", () => {
    const value = computeMetricValue(mockAgent, "unknownMetric" as HeatmapMetric, allAgents);
    expect(value).toBe(0.5);
  });
});

describe("renderHeatmapNode", () => {
  it("is exported as a function", () => {
    expect(typeof renderHeatmapNode).toBe("function");
  });
});

describe("renderHeatmapLegend", () => {
  it("is exported as a function", () => {
    expect(typeof renderHeatmapLegend).toBe("function");
  });
});
