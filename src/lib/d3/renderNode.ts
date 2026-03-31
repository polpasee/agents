import * as d3 from "d3";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { getTokenPercent } from "@/lib/utils";
import { GRAPH } from "@/lib/config";
import type { AgentState } from "@/lib/types";

/**
 * Render the visual elements (circle, label, token bar, status, sparkline)
 * inside a D3 node `<g>` group element. Called on initial render and when
 * a node's visual hash changes (status, tokens, tool calls, selection).
 */
export function renderNodeVisuals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g: d3.Selection<SVGGElement, any, any, any>,
  agent: AgentState,
  selectedAgentId: string | null,
) {
  const color = AGENT_COLORS[agent.agentType] || UI.text.secondary;
  const statusColor = STATUS_COLORS[agent.status] || UI.text.muted;
  const label = AGENT_LABELS[agent.agentType] || "AGENT";
  const tokenPercent = getTokenPercent(agent);
  const isSelected = agent.id === selectedAgentId;
  const isActive = agent.status === "running" || agent.status === "idle";
  const isRunning = agent.status === "running";

  const isFinished = agent.status === "completed" || agent.status === "error";
  if (isFinished) {
    g.attr("opacity", 0.35);
  }

  const lastTool = agent.toolCalls.length > 0
    ? agent.toolCalls[agent.toolCalls.length - 1].tool
    : null;
  const statusLabel = isRunning && lastTool
    ? lastTool
    : agent.status === "idle" ? "thinking" : agent.status;

  // Pulsing ring for active agents (running or idle/thinking)
  if (isActive) {
    const ring = g.append("circle")
      .attr("r", GRAPH.glowRingRadius + 4)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0);
    ring.append("animate")
      .attr("attributeName", "stroke-opacity")
      .attr("values", isRunning ? "0.1;0.5;0.1" : "0.05;0.25;0.05")
      .attr("dur", isRunning ? "1.5s" : "2.5s")
      .attr("repeatCount", "indefinite");
    ring.append("animate")
      .attr("attributeName", "r")
      .attr("values", isRunning
        ? `${GRAPH.glowRingRadius + 2};${GRAPH.glowRingRadius + 8};${GRAPH.glowRingRadius + 2}`
        : `${GRAPH.glowRingRadius + 1};${GRAPH.glowRingRadius + 5};${GRAPH.glowRingRadius + 1}`)
      .attr("dur", isRunning ? "1.5s" : "2.5s")
      .attr("repeatCount", "indefinite");
  }

  // Outer glow ring for selected/active
  if (isSelected || isActive) {
    g.append("circle")
      .attr("r", GRAPH.glowRingRadius)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", isSelected ? 2 : 1)
      .attr("stroke-opacity", isActive ? 0.4 : 0.3)
      .attr("filter", "url(#glow)");
  }

  // Main circle — solid dark background so links don't show through
  const mainCircle = g.append("circle")
    .attr("r", GRAPH.nodeRadius)
    .attr("fill", "var(--color-bg)")
    .attr("stroke", color)
    .attr("stroke-width", 2);

  // Subtle stroke pulse for running agents
  if (isRunning) {
    mainCircle.append("animate")
      .attr("attributeName", "stroke-opacity")
      .attr("values", "1;0.5;1")
      .attr("dur", "1.5s")
      .attr("repeatCount", "indefinite");
  }

  // Letter inside circle
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", 16)
    .attr("font-weight", "bold")
    .style("pointer-events", "none")
    .text(label.charAt(0));

  // Label below
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", 34)
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", 11)
    .attr("font-weight", "bold")
    .attr("letter-spacing", "2px")
    .style("pointer-events", "none")
    .text(label);

  // Token bar
  const barW = GRAPH.tokenBarWidth;
  const barH = GRAPH.tokenBarHeight;
  const barY = GRAPH.tokenBarY;
  g.append("rect")
    .attr("x", -barW / 2).attr("y", barY)
    .attr("width", barW).attr("height", barH)
    .attr("rx", 1).attr("fill", `${color}22`);
  if (tokenPercent > 0) {
    g.append("rect")
      .attr("x", -barW / 2).attr("y", barY)
      .attr("width", barW * tokenPercent / 100).attr("height", barH)
      .attr("rx", 1).attr("fill", color);
  }

  // Status dot + label
  const statusY = GRAPH.statusY;
  g.append("circle")
    .attr("cx", -14).attr("cy", statusY)
    .attr("r", 3).attr("fill", statusColor);
  g.append("text")
    .attr("x", -7).attr("y", statusY + 4)
    .attr("fill", statusColor)
    .attr("font-family", "monospace")
    .attr("font-size", 10)
    .style("pointer-events", "none")
    .text(statusLabel);

  // Tool call sparkline
  if (agent.toolCalls.length > 0) {
    const now = Date.now();
    const buckets = new Array(GRAPH.sparklineBuckets).fill(0);
    for (const tc of agent.toolCalls) {
      const age = now - tc.timestamp;
      const bucketIdx = GRAPH.sparklineBuckets - 1 - Math.floor(age / GRAPH.sparklineBucketMs);
      if (bucketIdx >= 0 && bucketIdx < GRAPH.sparklineBuckets) {
        buckets[bucketIdx]++;
      }
    }
    const maxVal = Math.max(...buckets, 1);
    const sparkBarW = GRAPH.sparklineWidth / GRAPH.sparklineBuckets;
    const sparkG = g.append("g")
      .attr("transform", `translate(${-GRAPH.sparklineWidth / 2}, ${GRAPH.sparklineY})`);
    for (let i = 0; i < GRAPH.sparklineBuckets; i++) {
      const h = (buckets[i] / maxVal) * GRAPH.sparklineHeight;
      sparkG.append("rect")
        .attr("x", i * sparkBarW)
        .attr("y", GRAPH.sparklineHeight - h)
        .attr("width", sparkBarW - 0.5)
        .attr("height", h)
        .attr("fill", color)
        .attr("opacity", 0.6);
    }
  }
}
