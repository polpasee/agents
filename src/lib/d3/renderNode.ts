import * as d3 from "d3";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { getTokenPercent, formatNumber, formatDuration } from "@/lib/utils";
import { calculateCost, formatCost } from "@/lib/costs";
import { GRAPH } from "@/lib/config";
import type { AgentState } from "@/lib/types";

/* ── Hexagonal path generator (flat-top hexagon) ────────── */
export function hexPath(r: number): string {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return `M${points.join("L")}Z`;
}

/* ── Wrap tool text into multi-line array for activity circle ── */
export function wrapToolText(tool: string, args: string | undefined, maxLines: number, maxChars: number): string[] {
  // Truncate tool name to fit within maxChars
  const toolLabel = tool.toUpperCase() + ":";
  const firstLine = toolLabel.length > maxChars
    ? toolLabel.slice(0, maxChars - 2) + ".."
    : toolLabel;
  const lines: string[] = [firstLine];
  if (!args) return lines;

  // Word-wrap: split into words, fill lines without breaking words
  const words = args.split(/(\s+|(?<=[:,/])|(?=\/))/);
  let currentLine = "";

  for (const word of words) {
    if (lines.length >= maxLines) break;
    const trimmed = word.replace(/^\s+/, "");
    if (!trimmed) {
      if (currentLine) currentLine += " ";
      continue;
    }

    if (currentLine.length + trimmed.length <= maxChars) {
      currentLine += trimmed;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        if (lines.length >= maxLines) break;
      }
      // If a single word exceeds maxChars, truncate it
      currentLine = trimmed.length > maxChars
        ? trimmed.slice(0, maxChars - 4) + "...."
        : trimmed;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Truncate last line with ellipsis if we ran out of space
  if (lines.length >= maxLines && lines[lines.length - 1].length > maxChars) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, maxChars - 4) + "....";
  }

  return lines.slice(0, maxLines);
}

/* ── Render the visual elements inside a node <g> ──────── */
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

  const isSubAgent = !!(agent.parentId && !agent.teamId);
  const isFinished = agent.status === "completed" || agent.status === "error";
  if (isFinished) {
    g.attr("opacity", 0.35);
  }

  // ── Effective radius & scale for sub-agents ──
  const r = isSubAgent ? GRAPH.subAgentNodeRadius : GRAPH.nodeRadius;
  const scale = r / GRAPH.nodeRadius;
  const centerFont = Math.max(13, Math.round(24 * scale));
  const labelY = Math.round(52 * scale);
  const labelFontSize = Math.max(8, Math.round(13 * scale));
  const costFontSize = Math.max(7, Math.round(10 * scale));
  const barW = Math.round(GRAPH.tokenBarWidth * scale);
  const barH = Math.max(2, Math.round(GRAPH.tokenBarHeight * scale));
  const barY = Math.round(GRAPH.tokenBarY * scale);
  const sY = Math.round(GRAPH.statusY * scale);
  const statusFontSize = Math.max(7, Math.round(10 * scale));
  const statsFontSize = Math.max(7, Math.round(9 * scale));
  const orbitR = r + Math.round(30 * scale);
  const childR = Math.max(6, Math.round(12 * scale));
  const childFont = Math.max(5, Math.round(7 * scale));
  const contextRingR = r + Math.round(5 * scale);
  const contextStroke = Math.max(2, Math.round(3 * scale));
  const sparkW = Math.round(GRAPH.sparklineWidth * scale);
  const sparkH = Math.max(6, Math.round(GRAPH.sparklineHeight * scale));
  const sparkY = Math.round(GRAPH.sparklineY * scale);

  const lastTool = agent.toolCalls.length > 0
    ? agent.toolCalls[agent.toolCalls.length - 1].tool
    : null;
  const statusLabel = isRunning && lastTool
    ? lastTool
    : agent.status === "idle" ? "thinking" : agent.status;

  // Determine if activity circle mode is active
  const lastToolCall = agent.toolCalls.length > 0 ? agent.toolCalls[agent.toolCalls.length - 1] : null;
  const hasActiveToolCall = !!(lastToolCall && (agent.status === "running" || agent.status === "idle"));

  // Pulsing ring for active agents (only in hex mode — activity circle has its own pulse)
  if (isActive && !hasActiveToolCall) {
    const ring = g.append("path")
      .attr("d", hexPath(GRAPH.glowRingRadius + 4))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0);
    ring.append("animate")
      .attr("attributeName", "stroke-opacity")
      .attr("values", isRunning ? "0.1;0.5;0.1" : "0.05;0.25;0.05")
      .attr("dur", isRunning ? "1.5s" : "2.5s")
      .attr("repeatCount", "indefinite");
  }

  // Outer glow ring for selected/active (only in hex mode)
  if ((isSelected || isActive) && !hasActiveToolCall) {
    g.append("path")
      .attr("d", hexPath(GRAPH.glowRingRadius))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", isSelected ? 2 : 1)
      .attr("stroke-opacity", isActive ? 0.4 : 0.3)
      .attr("filter", "url(#glow)");
  }

  // ── Node shape: circle for sub-agents, hexagon for teammates/main ──
  if (isSubAgent) {
    // ── Circle node (sub-agent) ──
    if (isActive) {
      const outerGlow = g.append("circle")
        .attr("r", r + Math.round(8 * scale))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.2);
      outerGlow.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "0.1;0.35;0.1")
        .attr("dur", isRunning ? "1.5s" : "2.5s")
        .attr("repeatCount", "indefinite");

      g.append("circle")
        .attr("r", r + Math.round(4 * scale))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.35);
    }

    const mainCircle = g.append("circle")
      .attr("r", r)
      .attr("fill", "var(--color-bg)")
      .attr("stroke", color)
      .attr("stroke-width", isActive ? 2.5 : 2);

    if (isRunning) {
      mainCircle.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "1;0.6;1")
        .attr("dur", "1.5s")
        .attr("repeatCount", "indefinite");
    }

    if (isActive) {
      g.append("circle")
        .attr("r", r - Math.round(7 * scale))
        .attr("fill", "none")
        .attr("stroke", `${color}44`)
        .attr("stroke-width", 1);
    }
  } else {
    // ── Hexagon node (main / teammate / team-lead) ──
    if (isActive) {
      const outerGlow = g.append("path")
        .attr("d", hexPath(GRAPH.nodeRadius + 10))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.2);
      outerGlow.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "0.1;0.35;0.1")
        .attr("dur", isRunning ? "1.5s" : "2.5s")
        .attr("repeatCount", "indefinite");

      g.append("path")
        .attr("d", hexPath(GRAPH.nodeRadius + 5))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.35);
    }

    const mainHex = g.append("path")
      .attr("d", hexPath(GRAPH.nodeRadius))
      .attr("fill", "var(--color-bg)")
      .attr("stroke", color)
      .attr("stroke-width", isActive ? 2.5 : 2);

    if (isRunning) {
      mainHex.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "1;0.6;1")
        .attr("dur", "1.5s")
        .attr("repeatCount", "indefinite");
    }

    if (isActive) {
      g.append("path")
        .attr("d", hexPath(GRAPH.nodeRadius - 8))
        .attr("fill", "none")
        .attr("stroke", `${color}44`)
        .attr("stroke-width", 1);
    }
  }

  // Letter inside node
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", centerFont)
    .attr("font-weight", "bold")
    .style("pointer-events", "none")
    .text(label.charAt(0));

  // Label below node
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", labelY)
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", labelFontSize)
    .attr("font-weight", "bold")
    .attr("letter-spacing", "2px")
    .style("pointer-events", "none")
    .text(label);

  // Context usage ring (wraps the effective shape)
  // Context usage ring (only in hex mode — activity circle keeps it clean)
  const totalTokens = agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
  if (!hasActiveToolCall && totalTokens > 0 && agent.contextWindow > 0) {
    const usagePct = Math.min(totalTokens / agent.contextWindow, 1);
    const ringR = contextRingR;
    const ringStroke = contextStroke;
    const ringOpacity = 0.7;
    const segments = [
      { value: agent.inputTokens, color: UI.primary },           // cyan - input
      { value: agent.outputTokens, color: "#00ff88" },            // green - output
      { value: agent.cacheReadTokens, color: "#3b82f6" },         // blue - cache read
      { value: agent.cacheCreateTokens, color: "#ffaa00" },       // amber - cache write
    ].filter(s => s.value > 0);

    let startAngle = -Math.PI / 2; // start from top

    for (const seg of segments) {
      const sweepAngle = (seg.value / agent.contextWindow) * Math.PI * 2;
      if (sweepAngle < 0.01) continue;
      const endAngle = startAngle + sweepAngle;
      const x1 = ringR * Math.cos(startAngle);
      const y1 = ringR * Math.sin(startAngle);
      const x2 = ringR * Math.cos(endAngle);
      const y2 = ringR * Math.sin(endAngle);
      const largeArc = sweepAngle > Math.PI ? 1 : 0;

      g.append("path")
        .attr("d", `M${x1},${y1} A${ringR},${ringR} 0 ${largeArc} 1 ${x2},${y2}`)
        .attr("fill", "none")
        .attr("stroke", seg.color)
        .attr("stroke-width", ringStroke)
        .attr("stroke-opacity", ringOpacity)
        .attr("stroke-linecap", "round");

      startAngle = endAngle;
    }

    // Background track for remaining capacity
    if (usagePct < 1) {
      const remainAngle = startAngle;
      const endAngle = -Math.PI / 2 + Math.PI * 2;
      if (endAngle - remainAngle > 0.01) {
        const x1 = ringR * Math.cos(remainAngle);
        const y1 = ringR * Math.sin(remainAngle);
        const x2 = ringR * Math.cos(endAngle);
        const y2 = ringR * Math.sin(endAngle);
        const largeArc = (endAngle - remainAngle) > Math.PI ? 1 : 0;
        g.append("path")
          .attr("d", `M${x1},${y1} A${ringR},${ringR} 0 ${largeArc} 1 ${x2},${y2}`)
          .attr("fill", "none")
          .attr("stroke", UI.text.empty)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.15);
      }
    }
  }

  // Cost label above node (dynamic based on effective radius)
  const cost = calculateCost(agent);
  if (cost.total >= 0.01) {
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", -(r + Math.round(8 * scale)))
      .attr("fill", UI.primary)
      .attr("font-family", "monospace")
      .attr("font-size", costFontSize)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(formatCost(cost.total));
  }

  // Token bar
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


  // Status info under node
  const allTokens = agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
  const elapsed = agent.duration ?? (Date.now() - agent.startTime);

  // Line 1: status label
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", sY + Math.round(4 * scale))
    .attr("fill", statusColor)
    .attr("font-family", "monospace")
    .attr("font-size", statusFontSize)
    .style("pointer-events", "none")
    .text(agent.status);

  // Line 2: tokens + duration
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", sY + Math.round(18 * scale))
    .attr("fill", UI.text.dimmed)
    .attr("font-family", "monospace")
    .attr("font-size", statsFontSize)
    .style("pointer-events", "none")
    .text(`${formatNumber(allTokens)} tok · ${formatDuration(elapsed)}`);

  // Activity child circles — show only tool calls from last 20s
  if (agent.toolCalls.length > 0 && isActive) {
    const now = Date.now();
    const ACTIVITY_WINDOW = 20_000;
    const maxChildren = 5;
    const recentCalls = agent.toolCalls
      .filter((tc) => now - tc.timestamp < ACTIVITY_WINDOW)
      .slice(-maxChildren);
    const childRadius = childR;
    const orbitRadius = orbitR;
    // Spread children in an arc on the right side (-60° to +60°)
    const arcStart = -Math.PI / 3;
    const arcEnd = Math.PI / 3;

    recentCalls.forEach((tc, i) => {
      const angle = recentCalls.length === 1
        ? 0
        : arcStart + (arcEnd - arcStart) * (i / (recentCalls.length - 1));
      const cx = Math.cos(angle) * orbitRadius;
      const cy = Math.sin(angle) * orbitRadius;
      const isLast = i === recentCalls.length - 1;

      // Connector line
      g.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", cx).attr("y2", cy)
        .attr("stroke", `${color}22`)
        .attr("stroke-width", 1);

      // Child circle
      g.append("circle")
        .attr("cx", cx).attr("cy", cy)
        .attr("r", childRadius)
        .attr("fill", isLast ? `${color}18` : `${color}08`)
        .attr("stroke", isLast ? `${color}88` : `${color}33`)
        .attr("stroke-width", 1);

      // Tool name label
      const toolName = tc.tool.length > 6 ? tc.tool.slice(0, 5) + "\u2026" : tc.tool;
      g.append("text")
        .attr("x", cx).attr("y", cy + 3)
        .attr("text-anchor", "middle")
        .attr("fill", isLast ? `${color}cc` : `${color}66`)
        .attr("font-family", "monospace")
        .attr("font-size", childFont)
        .attr("font-weight", isLast ? "bold" : "normal")
        .style("pointer-events", "none")
        .text(toolName);
    });
  }

  // Sparkline
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
    const sparkBarW = sparkW / GRAPH.sparklineBuckets;
    const sparkG = g.append("g")
      .attr("transform", `translate(${-sparkW / 2}, ${sparkY})`);
    for (let i = 0; i < GRAPH.sparklineBuckets; i++) {
      const h = (buckets[i] / maxVal) * sparkH;
      sparkG.append("rect")
        .attr("x", i * sparkBarW)
        .attr("y", sparkH - h)
        .attr("width", sparkBarW - 0.5)
        .attr("height", h)
        .attr("fill", color)
        .attr("opacity", 0.6);
    }
  }

}
