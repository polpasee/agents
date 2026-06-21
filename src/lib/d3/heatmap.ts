import { scaleLinear } from "d3-scale";
import type { ScaleLinear } from "d3-scale";
import type { Selection } from "d3-selection";
import type { AgentState, HeatmapMetric } from "../types";
import { GRAPH, HEATMAP, getNodeRadius } from "../config";
import { depthFactor } from "./depth";
import { AGENT_LABELS } from "../colors";

/** Create a green→yellow→red color scale */
export function createHeatmapScale(): ScaleLinear<string, string> {
  return scaleLinear<string>()
    .domain([0, 0.5, 1])
    .range(HEATMAP.colors)
    .clamp(true);
}

/** Pre-computed normalization values to avoid O(n²) in per-agent metric calls */
export interface HeatmapNorms {
  maxTtft: number;
}

/** Pre-compute normalization values from all agents (call once per render pass) */
export function precomputeHeatmapNorms(allAgents: AgentState[]): HeatmapNorms {
  let maxTtft = 1;
  for (const a of allAgents) {
    if (a.toolCalls.length > 0) {
      // Use the earliest timestamp across all stored tool calls. After eviction
      // the first stored entry is no longer the chronologically earliest.
      const earliest = Math.min(...a.toolCalls.map((t) => t.timestamp));
      maxTtft = Math.max(maxTtft, earliest - a.startTime);
    }
  }
  return { maxTtft };
}

/** Compute a 0-1 metric value for an agent. 0=healthy, 1=bottleneck */
export function computeMetricValue(
  agent: AgentState,
  metric: HeatmapMetric,
  norms: HeatmapNorms,
): number {
  switch (metric) {
    case "idleRatio": {
      // Approximate idle ratio from tool call gaps
      const elapsed = agent.duration ?? Date.now() - agent.startTime;
      if (elapsed <= 0 || agent.toolCalls.length === 0) return 0.5;
      let busyTime = 0;
      for (let i = 1; i < agent.toolCalls.length; i++) {
        // safe: loop starts at 1 and stays < length, so i and i-1 are valid indices
        const gap =
          agent.toolCalls[i]!.timestamp - agent.toolCalls[i - 1]!.timestamp;
        if (gap < 5000) busyTime += gap; // gaps < 5s count as busy
      }
      const idleRatio = 1 - busyTime / elapsed;
      return Math.max(0, Math.min(1, idleRatio));
    }
    case "tokenEfficiency": {
      const total = agent.inputTokens + agent.outputTokens;
      if (total === 0) return 0.5;
      const outputRatio = agent.outputTokens / total;
      return Math.max(0, Math.min(1, 1 - outputRatio * 3));
    }
    case "timeToFirstTool": {
      if (agent.toolCalls.length === 0) return 1;
      // Use the earliest timestamp across all stored tool calls (matches the
      // normalizer in precomputeHeatmapNorms) to avoid skew after eviction.
      const earliest = Math.min(...agent.toolCalls.map((t) => t.timestamp));
      const ttft = earliest - agent.startTime;
      return ttft / norms.maxTtft;
    }
    case "avgToolLatency": {
      if (agent.toolCalls.length < 2) return 0.5;
      let totalGap = 0;
      for (let i = 1; i < agent.toolCalls.length; i++) {
        // safe: loop starts at 1 and stays < length, so i and i-1 are valid indices
        totalGap +=
          agent.toolCalls[i]!.timestamp - agent.toolCalls[i - 1]!.timestamp;
      }
      const avgGap = totalGap / (agent.toolCalls.length - 1);
      return Math.max(0, Math.min(1, avgGap / 30000));
    }
    default:
      return 0.5;
  }
}

/** Render a single node in heatmap mode */
export function renderHeatmapNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- d3 Selection datum/parent generics are intentionally unconstrained here (mirrors renderNodeVisuals)
  g: Selection<SVGGElement, any, any, any>,
  agent: AgentState,
  metricValue: number,
  colorScale: ScaleLinear<string, string>,
  isSelected: boolean,
  depth?: number,
): void {
  const color = colorScale(metricValue);
  const r = getNodeRadius(agent, depthFactor(depth));
  const hScale = r / GRAPH.nodeRadius;

  // Clear existing children
  g.selectAll("*").remove();

  // Glow ring for selected
  if (isSelected) {
    g.append("circle")
      .attr(
        "r",
        r + Math.round((GRAPH.glowRingRadius - GRAPH.nodeRadius) * hScale),
      )
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .attr("opacity", 0.5)
      .style("filter", `drop-shadow(0 0 6px ${color})`);
  }

  // Main circle with heatmap color fill
  g.append("circle")
    .attr("r", r)
    .attr("fill", `${color}22`)
    .attr("stroke", color)
    .attr("stroke-width", 2);

  // Agent type label inside
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", color)
    .attr("font-size", `${Math.max(8, Math.round(11 * hScale))}px`)
    .attr("font-weight", "bold")
    .attr("font-family", "monospace")
    .text(AGENT_LABELS[agent.agentType]?.[0] || "?");

  // Type label below
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", Math.round(34 * hScale))
    .attr("fill", color)
    .attr("font-size", `${Math.max(7, Math.round(9 * hScale))}px`)
    .attr("font-weight", "bold")
    .attr("font-family", "monospace")
    .attr("letter-spacing", "2px")
    .text(AGENT_LABELS[agent.agentType] || "AGENT");

  // Metric value below that
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", Math.round(48 * hScale))
    .attr("fill", color)
    .attr("font-size", `${Math.max(7, Math.round(10 * hScale))}px`)
    .attr("font-family", "monospace")
    .attr("opacity", 0.8)
    .text(`${(metricValue * 100).toFixed(0)}%`);
}

/** Render the heatmap legend gradient bar */
export function renderHeatmapLegend(
  svg: Selection<SVGSVGElement, unknown, null, undefined>,
  metric: HeatmapMetric,
  x: number,
  y: number,
): void {
  const legendId = "heatmap-legend";
  svg.select(`#${legendId}`).remove();

  const g = svg
    .append("g")
    .attr("id", legendId)
    .attr("transform", `translate(${x}, ${y})`);

  const w = HEATMAP.legendWidth;
  const h = HEATMAP.legendHeight;

  // Gradient definition
  const defs = svg.select("defs").empty()
    ? svg.append("defs")
    : svg.select("defs");
  defs.select("#heatmap-grad").remove();
  const gradient = defs.append("linearGradient").attr("id", "heatmap-grad");
  gradient
    .append("stop")
    .attr("offset", "0%")
    .attr("stop-color", HEATMAP.colors[0]);
  gradient
    .append("stop")
    .attr("offset", "50%")
    .attr("stop-color", HEATMAP.colors[1]);
  gradient
    .append("stop")
    .attr("offset", "100%")
    .attr("stop-color", HEATMAP.colors[2]);

  // Background
  g.append("rect")
    .attr("x", -4)
    .attr("y", -20)
    .attr("width", w + 8)
    .attr("height", h + 36)
    .attr("rx", 4)
    .attr("fill", "rgba(0,0,0,0.7)");

  // Metric label
  const labels: Record<HeatmapMetric, string> = {
    idleRatio: "Idle Ratio",
    tokenEfficiency: "Token Efficiency",
    timeToFirstTool: "Time to First Tool",
    avgToolLatency: "Avg Tool Latency",
  };
  g.append("text")
    .attr("x", w / 2)
    .attr("y", -6)
    .attr("text-anchor", "middle")
    .attr("fill", "#94a3b8")
    .attr("font-size", "9px")
    .attr("font-family", "monospace")
    .text(labels[metric] || metric);

  // Gradient bar
  g.append("rect")
    .attr("width", w)
    .attr("height", h)
    .attr("rx", 2)
    .attr("fill", "url(#heatmap-grad)");

  // Min/max labels
  g.append("text")
    .attr("y", h + 12)
    .attr("fill", HEATMAP.colors[0])
    .attr("font-size", "8px")
    .attr("font-family", "monospace")
    .text("Healthy");

  g.append("text")
    .attr("x", w)
    .attr("y", h + 12)
    .attr("text-anchor", "end")
    .attr("fill", HEATMAP.colors[2])
    .attr("font-size", "8px")
    .attr("font-family", "monospace")
    .text("Bottleneck");
}
