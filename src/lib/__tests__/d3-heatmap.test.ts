import { describe, it, expect } from "vitest";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import {
  createHeatmapScale,
  computeMetricValue,
  precomputeHeatmapNorms,
  renderHeatmapNode,
  renderHeatmapLegend,
} from "../d3/heatmap";
import { GRAPH } from "../config";
import type { AgentState, HeatmapMetric } from "../types";
import { mockAgent as createMockAgent } from "./test-utils";

const mockAgent = createMockAgent({
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
});

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
  const norms = precomputeHeatmapNorms(allAgents);

  it("returns a number between 0 and 1 for tokenEfficiency", () => {
    const value = computeMetricValue(mockAgent, "tokenEfficiency", norms);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for idleRatio", () => {
    const value = computeMetricValue(mockAgent, "idleRatio", norms);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for timeToFirstTool", () => {
    const value = computeMetricValue(mockAgent, "timeToFirstTool", norms);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns a number between 0 and 1 for avgToolLatency", () => {
    const value = computeMetricValue(mockAgent, "avgToolLatency", norms);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("returns 0.5 for tokenEfficiency when agent has no tokens", () => {
    const emptyAgent: AgentState = {
      ...mockAgent,
      inputTokens: 0,
      outputTokens: 0,
    };
    const value = computeMetricValue(emptyAgent, "tokenEfficiency", precomputeHeatmapNorms([emptyAgent]));
    expect(value).toBe(0.5);
  });

  it("returns 1 for timeToFirstTool when agent has no tool calls", () => {
    const noToolAgent: AgentState = {
      ...mockAgent,
      toolCalls: [],
    };
    const value = computeMetricValue(noToolAgent, "timeToFirstTool", precomputeHeatmapNorms([noToolAgent]));
    expect(value).toBe(1);
  });

  it("returns 0.5 for unknown metric", () => {
    const value = computeMetricValue(mockAgent, "unknownMetric" as HeatmapMetric, norms);
    expect(value).toBe(0.5);
  });
});

describe("precomputeHeatmapNorms — earliest timestamp", () => {
  it("uses the earliest tool call timestamp when calls are not in ascending order", () => {
    // Stored toolCalls are in reverse order (as if early entries were evicted
    // and later ones remain, but also covers an out-of-order scenario).
    const agent = createMockAgent({
      startTime: 0,
      toolCalls: [
        { tool: "bash", timestamp: 5000 }, // stored first, but NOT earliest
        { tool: "read", timestamp: 2000 }, // earliest
      ],
    });
    const norms = precomputeHeatmapNorms([agent]);
    // Earliest timestamp is 2000, so maxTtft should be 2000 - 0 = 2000.
    expect(norms.maxTtft).toBe(2000);
  });

  it("maxTtft is 1 when no agent has tool calls", () => {
    const agent = createMockAgent({ toolCalls: [] });
    const norms = precomputeHeatmapNorms([agent]);
    expect(norms.maxTtft).toBe(1);
  });
});

describe("computeMetricValue — timeToFirstTool uses earliest timestamp", () => {
  it("uses the minimum timestamp across toolCalls when calls are out of order", () => {
    const startTime = 0;
    // toolCalls stored with a later timestamp first (post-eviction scenario).
    const agent = createMockAgent({
      startTime,
      toolCalls: [
        { tool: "bash", timestamp: 9000 }, // later call stored first
        { tool: "read", timestamp: 3000 }, // earliest call stored second
      ],
    });
    // maxTtft = earliest ttft = 3000
    const norms = precomputeHeatmapNorms([agent]);
    expect(norms.maxTtft).toBe(3000);

    const value = computeMetricValue(agent, "timeToFirstTool", norms);
    // ttft = 3000, maxTtft = 3000 → ratio = 1.0
    expect(value).toBeCloseTo(1.0);
  });

  it("normalizer and metric agree when toolCalls are in ascending order", () => {
    const agent = createMockAgent({
      startTime: 0,
      toolCalls: [
        { tool: "bash", timestamp: 1000 },
        { tool: "read", timestamp: 4000 },
      ],
    });
    const norms = precomputeHeatmapNorms([agent]);
    // Both should use timestamp 1000 as the earliest
    expect(norms.maxTtft).toBe(1000);
    const value = computeMetricValue(agent, "timeToFirstTool", norms);
    expect(value).toBeCloseTo(1.0);
  });
});

describe("renderHeatmapNode", () => {
  it("is exported as a function", () => {
    expect(typeof renderHeatmapNode).toBe("function");
  });

  // With isSelected=false the first circle appended is the main node circle,
  // so its `r` pins down the effective radius exactly.
  function renderRadius(agent: AgentState, depth?: number): number {
    const svg = select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = svg.append("g") as Selection<SVGGElement, any, any, any>;
    renderHeatmapNode(g, agent, 0.5, createHeatmapScale(), false, depth);
    return Number(g.select("circle").attr("r"));
  }

  it("shrinks depth-2 sub-agents by one depthScale step", () => {
    const agent = createMockAgent({ parentId: "p1" });
    expect(renderRadius(agent, 2)).toBe(GRAPH.subAgentNodeRadius * GRAPH.depthScale);
  });

  it("renders depth-1 and depth-omitted sub-agents at the flat radius", () => {
    const agent = createMockAgent({ parentId: "p1" });
    expect(renderRadius(agent, 1)).toBe(GRAPH.subAgentNodeRadius);
    expect(renderRadius(agent)).toBe(GRAPH.subAgentNodeRadius);
  });

  it("keeps team members full-size regardless of depth", () => {
    const agent = createMockAgent({ parentId: "p1", teamId: "t1" });
    expect(renderRadius(agent, 2)).toBe(GRAPH.nodeRadius);
  });
});

describe("renderHeatmapLegend", () => {
  it("is exported as a function", () => {
    expect(typeof renderHeatmapLegend).toBe("function");
  });
});
