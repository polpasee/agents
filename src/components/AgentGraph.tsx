"use client";

import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, EDGE_COLORS, UI } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { GRAPH } from "@/lib/config";
import { calculateCost, formatCost } from "@/lib/costs";
import { renderHeatmapNode, renderHeatmapLegend, computeMetricValue, createHeatmapScale } from "@/lib/d3";
import type { AgentState, GraphLayout } from "@/lib/types";
import { applyTreeLayout, applyRadialLayout, applyHierarchicalLayout } from "@/lib/d3/layouts";

export interface AgentGraphHandle {
  fitToView(): void;
  getNodesAndViewport(): {
    nodes: Array<{ x: number; y: number; color: string }>;
    viewport: { x: number; y: number; width: number; height: number };
  } | null;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  agent: AgentState;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  edgeType?: "parent" | "message" | "blocking";
}

/* ── Hexagonal path generator (flat-top hexagon) ────────── */
function hexPath(r: number): string {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return `M${points.join("L")}Z`;
}

/* ── Bezier curve path between two points ───────────────── */
function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = dist * 0.3;
  // Perpendicular offset for curve
  const nx = -dy / (dist || 1) * offset;
  const ny = dx / (dist || 1) * offset;
  const cx1 = sx + dx * 0.25 + nx;
  const cy1 = sy + dy * 0.25 + ny;
  const cx2 = sx + dx * 0.75 + nx;
  const cy2 = sy + dy * 0.75 + ny;
  return `M${sx},${sy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`;
}

/* ── Status colors & agent labels (used by inline renderNodeVisuals) ── */
import { STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import { getTokenPercent } from "@/lib/utils";

/* ── Wrap tool text into multi-line array for activity circle ── */
function wrapToolText(tool: string, args: string | undefined, maxLines: number, maxChars: number): string[] {
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
function renderNodeVisuals(
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

  // ── Activity bubble (speech bubble with tool text, offset to upper-left) ──
  if (hasActiveToolCall) {
    const bubbleX = -(GRAPH.activityCircleRadius + 10);
    const bubbleY = -(GRAPH.activityCircleRadius - 10);
    const bubbleG = g.append("g")
      .attr("transform", `translate(${bubbleX}, ${bubbleY})`);

    // Clip path for text
    const clipId = `clip-${agent.id.replace(/[^a-zA-Z0-9]/g, "")}`;
    const localDefs = bubbleG.append("defs");
    localDefs.append("clipPath")
      .attr("id", clipId)
      .append("circle")
      .attr("r", GRAPH.activityCircleRadius - 6);

    // Bubble circle background
    const bubbleCircle = bubbleG.append("circle")
      .attr("r", GRAPH.activityCircleRadius)
      .attr("fill", "var(--color-bg)")
      .attr("fill-opacity", 0.9)
      .attr("stroke", `${color}44`)
      .attr("stroke-width", 1);

    if (isRunning) {
      bubbleCircle.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "0.6;0.3;0.6")
        .attr("dur", "1.5s")
        .attr("repeatCount", "indefinite");
    }

    // Connector line from bubble to hex center
    g.append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", bubbleX + GRAPH.activityCircleRadius * 0.6)
      .attr("y2", bubbleY + GRAPH.activityCircleRadius * 0.6)
      .attr("stroke", `${color}33`)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3 3");

    // Multi-line tool text inside bubble — LEFT-aligned
    const maxChars = 16;
    const lines = wrapToolText(lastToolCall.tool, lastToolCall.args, GRAPH.activityMaxLines, maxChars);
    const lineHeight = 14;
    const totalHeight = lines.length * lineHeight;
    const startY = -totalHeight / 2 + lineHeight * 0.4;
    const textX = -GRAPH.activityCircleRadius + 14;

    const textG = bubbleG.append("g").attr("clip-path", `url(#${clipId})`);
    const textEl = textG.append("text")
      .attr("text-anchor", "start")
      .attr("fill", `${color}bb`)
      .attr("font-family", "monospace")
      .attr("font-size", 11)
      .style("pointer-events", "none");

    lines.forEach((line, i) => {
      textEl.append("tspan")
        .attr("x", textX)
        .attr("dy", i === 0 ? startY : lineHeight)
        .attr("font-weight", i === 0 ? "bold" : "normal")
        .attr("fill", i === 0 ? `${color}ee` : `${color}bb`)
        .text(line);
    });
  }

  // ── Hex node (always rendered at center) ─────────────────
  const mainHex = g.append("path")
    .attr("d", hexPath(GRAPH.nodeRadius))
    .attr("fill", "var(--color-bg)")
    .attr("stroke", color)
    .attr("stroke-width", 2);

  if (isRunning) {
    mainHex.append("animate")
      .attr("attributeName", "stroke-opacity")
      .attr("values", "1;0.5;1")
      .attr("dur", "1.5s")
      .attr("repeatCount", "indefinite");
  }

  // Letter inside hexagon
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", 24)
    .attr("font-weight", "bold")
    .style("pointer-events", "none")
    .text(label.charAt(0));

  // Label below hexagon
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", 52)
    .attr("fill", color)
    .attr("font-family", "monospace")
    .attr("font-size", 13)
    .attr("font-weight", "bold")
    .attr("letter-spacing", "2px")
    .style("pointer-events", "none")
    .text(label);

  // Context usage ring (wraps the effective shape)
  // Context usage ring (only in hex mode — activity circle keeps it clean)
  const totalTokens = agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
  if (!hasActiveToolCall && totalTokens > 0 && agent.contextWindow > 0) {
    const usagePct = Math.min(totalTokens / agent.contextWindow, 1);
    const ringR = GRAPH.nodeRadius + 5;
    const ringStroke = 3;
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
      .attr("y", -GRAPH.nodeRadius - 8)
      .attr("fill", UI.primary)
      .attr("font-family", "monospace")
      .attr("font-size", 10)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(formatCost(cost.total));
  }

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
    .attr("cx", -18).attr("cy", statusY)
    .attr("r", 4).attr("fill", statusColor);
  g.append("text")
    .attr("x", -10).attr("y", statusY + 5)
    .attr("fill", statusColor)
    .attr("font-family", "monospace")
    .attr("font-size", 12)
    .style("pointer-events", "none")
    .text(statusLabel);

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

/* ── Update link stroke colors and dash styles ─────────── */
function updateLinkVisuals(
  linkGlow: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>,
  linkLine: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>,
  agents: Map<string, AgentState>,
) {
  const getTargetId = (d: SimLink) =>
    typeof d.target === "string" ? d.target : d.target.id;

  linkGlow.attr("stroke", (d) => {
    if (d.edgeType === "message") {
      return UI.tool; // amber for message edges
    }
    const a = agents.get(getTargetId(d));
    return a ? AGENT_COLORS[a.agentType] : UI.text.secondary;
  });
  linkLine
    .attr("stroke", (d) => {
      if (d.edgeType === "message") {
        return UI.tool;
      }
      const a = agents.get(getTargetId(d));
      return a ? AGENT_COLORS[a.agentType] : UI.text.secondary;
    })
    .attr("stroke-dasharray", (d) => {
      if (d.edgeType === "message") return "4 3";
      const a = agents.get(getTargetId(d));
      const active = a?.status === "running" || a?.status === "idle";
      return active ? "8 4" : "none";
    })
    .each(function (d) {
      const a = agents.get(getTargetId(d));
      const active = a?.status === "running" || a?.status === "idle";
      const line = d3.select(this);
      // Remove existing animate children before adding new ones
      line.selectAll("animate").remove();
      if (d.edgeType !== "message" && active) {
        line.append("animate")
          .attr("attributeName", "stroke-dashoffset")
          .attr("values", "24;0")
          .attr("dur", a?.status === "running" ? "0.8s" : "1.6s")
          .attr("repeatCount", "indefinite");
      }
    });

  linkLine.attr("stroke-opacity", (d) => {
    if (d.edgeType === "message") return 0.5;
    const a = agents.get(getTargetId(d));
    const finished = a?.status === "completed" || a?.status === "error";
    return finished ? 0.2 : 0.6;
  });

  linkGlow.attr("stroke-opacity", (d) => {
    if (d.edgeType === "message") return 0.05;
    const a = agents.get(getTargetId(d));
    const finished = a?.status === "completed" || a?.status === "error";
    return finished ? 0.03 : 0.1;
  });
}

/* ── Component ─────────────────────────────────────────── */
export const AgentGraph = forwardRef<AgentGraphHandle>(function AgentGraph(_props, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const effectsRef = useRef<Array<{
    x: number;
    y: number;
    color: string;
    type: "spawn" | "complete" | "error";
    startTime: number;
    duration: number;
  }>>([]);
  const prevActivityLenRef = useRef(0);

  useImperativeHandle(ref, () => ({
    getNodesAndViewport() {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return null;
      const transform = d3.zoomTransform(svg);
      const nodes = nodesRef.current
        .filter((n) => n.x !== undefined && n.y !== undefined)
        .map((n) => ({
          x: n.x!,
          y: n.y!,
          color: AGENT_COLORS[n.agent.agentType] || UI.text.secondary,
        }));
      return {
        nodes,
        viewport: {
          x: -transform.x / transform.k,
          y: -transform.y / transform.k,
          width: svg.clientWidth / transform.k,
          height: svg.clientHeight / transform.k,
        },
      };
    },
    fitToView() {
      const svg = svgRef.current;
      const container = containerRef.current;
      const zoom = zoomRef.current;
      const nodes = nodesRef.current;
      if (!svg || !container || !zoom || nodes.length === 0) return;

      const padding = 80;
      const width = container.clientWidth;
      const height = container.clientHeight;

      // Calculate bounding box of all nodes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x);
          maxY = Math.max(maxY, n.y);
        }
      }
      if (!isFinite(minX)) return;

      const bboxW = maxX - minX || 1;
      const bboxH = maxY - minY || 1;
      const scale = Math.min(
        (width - padding * 2) / bboxW,
        (height - padding * 2) / bboxH,
        GRAPH.zoomExtent[1],
      );
      const clampedScale = Math.max(GRAPH.zoomExtent[0], Math.min(scale, GRAPH.zoomExtent[1]));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(clampedScale)
        .translate(-cx, -cy);

      d3.select(svg)
        .transition()
        .duration(500)
        // D3's zoom.transform overload doesn't match Transition types exactly — safe cast
        .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
    },
  }));

  const agents = useAgentStore((s) => s.agents);
  const edges = useAgentStore((s) => s.edges);
  const teams = useAgentStore((s) => s.teams);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const activity = useAgentStore((s) => s.activity);
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const heatmapEnabled = useAgentStore((s) => s.heatmapEnabled);
  const heatmapMetric = useAgentStore((s) => s.heatmapMetric);
  const graphLayout = useAgentStore((s) => s.graphLayout);
  const filteredAgents = useFilteredAgents();

  // Topology key — only changes when agents join/leave, parent links change, or edges change.
  // This controls when the force simulation is rebuilt.
  const topologyKey = useMemo(() => {
    const agentKeys = filteredAgents
      .map((a) => `${a.id}:${a.parentId || ""}:${a.teamId || ""}`)
      .sort()
      .join("|");
    const edgeKeys = edges
      .filter((e) => e.edgeType === "message" || e.edgeType === "blocking")
      .map((e) => `${e.edgeType === "blocking" ? "b" : "m"}:${e.source}:${e.target}`)
      .sort()
      .join("|");
    return `${agentKeys}||${edgeKeys}`;
  }, [filteredAgents, edges]);

  // ── Effect 1: Rebuild simulation when topology changes ──
  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const d3svg = d3.select(svg).attr("width", width).attr("height", height);
    d3svg.selectAll("*").remove();

    const agentIds = new Set(filteredAgents.map((a) => a.id));

    // Carry forward positions from previous simulation so layout stays stable
    const prevPositions = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      if (n.x !== undefined && n.y !== undefined) {
        prevPositions.set(n.id, { x: n.x, y: n.y });
      }
    }

    const nodes: SimNode[] = filteredAgents.map((a) => {
      const prev = prevPositions.get(a.id);
      return {
        id: a.id,
        agent: a,
        ...(prev ? { x: prev.x, y: prev.y } : {}),
      };
    });
    // Parent-child links
    const parentLinks: SimLink[] = filteredAgents
      .filter((a) => a.parentId && agentIds.has(a.parentId))
      .map((a) => ({ source: a.parentId!, target: a.id, edgeType: "parent" as const }));
    // Peer-to-peer message links
    const messageLinks: SimLink[] = edges
      .filter((e) => e.edgeType === "message" && agentIds.has(e.source) && agentIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, edgeType: "message" as const }));
    // Blocking dependency links
    const blockingLinks: SimLink[] = edges
      .filter((e) => e.edgeType === "blocking" && agentIds.has(e.source) && agentIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, edgeType: "blocking" as const }));
    const links: SimLink[] = [...parentLinks, ...messageLinks, ...blockingLinks];

    nodesRef.current = nodes;
    linksRef.current = links;

    if (nodes.length === 0) {
      d3svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", UI.text.empty)
        .attr("font-size", 14)
        .text("No agents connected");
      return;
    }

    // Defs for glow filters
    const defs = d3svg.append("defs");
    const glowFilter = defs.append("filter").attr("id", "glow");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", 3).attr("result", "blur");
    glowFilter.append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Arrowhead marker for blocking edges
    defs.append("marker")
      .attr("id", "arrowhead-blocking")
      .attr("viewBox", "0 0 10 6")
      .attr("refX", 38)
      .attr("refY", 3)
      .attr("markerWidth", 10)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,0 L10,3 L0,6 Z")
      .attr("fill", EDGE_COLORS.blocking)
      .attr("opacity", 0.8);

    // Canvas group for zoom/pan
    const canvas = d3svg.append("g").attr("class", "canvas");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH.zoomExtent)
      .on("zoom", (event) => canvas.attr("transform", event.transform));
    d3svg.call(zoom);
    zoomRef.current = zoom;

    // Background hex grid pattern
    const gridSize = 30;
    const gridPattern = defs.append("pattern")
      .attr("id", "hexGrid")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", gridSize * Math.sqrt(3))
      .attr("height", gridSize * 3)
      .attr("patternTransform", "rotate(0)");

    // Draw one hex cell in the pattern
    const hx = gridSize * Math.sqrt(3) / 2;
    const hy = gridSize;
    gridPattern.append("path")
      .attr("d", `M${hx},0 L${hx*2},${hy*0.5} L${hx*2},${hy*1.5} L${hx},${hy*2} L0,${hy*1.5} L0,${hy*0.5}Z`)
      .attr("fill", "none")
      .attr("stroke", "#141e30")
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.3);

    // Apply grid as background rect behind everything
    canvas.append("rect")
      .attr("x", -10000).attr("y", -10000)
      .attr("width", 20000).attr("height", 20000)
      .attr("fill", "url(#hexGrid)");

    // Team cluster backgrounds (rendered first so they appear behind everything)
    const teamClusterGroup = canvas.append("g").attr("class", "team-clusters");

    // Link groups (glow + main path) — using bezier paths
    const linkGroup = canvas.append("g").attr("class", "links");
    linkGroup.selectAll<SVGPathElement, SimLink>("path.glow")
      .data(links).join("path").attr("class", (d) => `glow ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", 6).attr("stroke-opacity", 0.1);
    linkGroup.selectAll<SVGPathElement, SimLink>("path.main")
      .data(links).join("path").attr("class", (d) => `main ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", (d) => d.edgeType === "message" ? 2 : 2.5)
      .attr("stroke-opacity", 0.7);

    // Apply initial link colors
    updateLinkVisuals(
      linkGroup.selectAll<SVGPathElement, SimLink>("path.glow"),
      linkGroup.selectAll<SVGPathElement, SimLink>("path.main"),
      agents,
    );

    // Particle group for link flow animation
    canvas.append("g").attr("class", "particles");

    // Effects group for lifecycle animations
    canvas.append("g").attr("class", "effects");

    // Node groups
    const nodeGroup = canvas.append("g").attr("class", "nodes");
    const nodeSelection = nodeGroup.selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => selectAgent(d.agent.id));

    // Render initial node visuals
    nodeSelection.each(function (d) {
      renderNodeVisuals(d3.select(this), d.agent, selectedAgentId);
    });

    // Drag behavior
    nodeSelection.call(
      d3.drag<SVGGElement, SimNode>()
        .on("start", (event) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        })
        .on("drag", (event) => {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        })
        .on("end", (event) => {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
        })
    );

    // Force simulation — use low alpha when restoring positions
    const linkGlow = linkGroup.selectAll<SVGPathElement, SimLink>("path.glow");
    const linkLine = linkGroup.selectAll<SVGPathElement, SimLink>("path.main");

    // Build team-to-nodes lookup for cluster rendering
    const teamNodeMap = new Map<string, SimNode[]>();
    for (const node of nodes) {
      if (node.agent.teamId) {
        const list = teamNodeMap.get(node.agent.teamId) || [];
        list.push(node);
        teamNodeMap.set(node.agent.teamId, list);
      }
    }

    const simulation = d3.forceSimulation<SimNode, SimLink>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(GRAPH.linkDistance))
      .force("charge", d3.forceManyBody().strength(GRAPH.chargeStrength))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius(GRAPH.collideRadius))
      .alpha(prevPositions.size > 0 ? GRAPH.newNodeAlpha : 1)
      .on("tick", () => {
        linkGlow.attr("d", (d) => bezierPath(
          (d.source as SimNode).x!, (d.source as SimNode).y!,
          (d.target as SimNode).x!, (d.target as SimNode).y!
        ));
        linkLine.attr("d", (d) => bezierPath(
          (d.source as SimNode).x!, (d.source as SimNode).y!,
          (d.target as SimNode).x!, (d.target as SimNode).y!
        ));
        nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y})`);

        // Render lifecycle effects
        const effectsGroup = d3svg.select<SVGGElement>("g.effects");
        if (!effectsGroup.empty()) {
          effectsGroup.selectAll("*").remove();
          const now = Date.now();
          effectsRef.current = effectsRef.current.filter(e => now - e.startTime < e.duration);

          for (const effect of effectsRef.current) {
            const progress = (now - effect.startTime) / effect.duration;
            const alpha = 1 - progress;

            if (effect.type === "spawn") {
              // Expanding hex ring
              const r = GRAPH.nodeRadius + progress * 40;
              effectsGroup.append("path")
                .attr("d", hexPath(r))
                .attr("transform", `translate(${effect.x},${effect.y})`)
                .attr("fill", "none")
                .attr("stroke", effect.color)
                .attr("stroke-width", 2 * alpha)
                .attr("stroke-opacity", alpha * 0.6);
            } else if (effect.type === "complete") {
              // Bright expanding ring
              const r = GRAPH.nodeRadius + progress * 60;
              effectsGroup.append("circle")
                .attr("cx", effect.x)
                .attr("cy", effect.y)
                .attr("r", r)
                .attr("fill", "none")
                .attr("stroke", "#00ff88")
                .attr("stroke-width", 1.5 * alpha)
                .attr("stroke-opacity", alpha * 0.5);
              // Inner flash (first 30%)
              if (progress < 0.3) {
                const flashAlpha = (0.3 - progress) / 0.3;
                effectsGroup.append("circle")
                  .attr("cx", effect.x)
                  .attr("cy", effect.y)
                  .attr("r", GRAPH.nodeRadius)
                  .attr("fill", "white")
                  .attr("opacity", flashAlpha * 0.15);
              }
            } else if (effect.type === "error") {
              // Red pulse glow
              const r = GRAPH.nodeRadius + progress * 30;
              effectsGroup.append("circle")
                .attr("cx", effect.x)
                .attr("cy", effect.y)
                .attr("r", r)
                .attr("fill", "none")
                .attr("stroke", UI.error)
                .attr("stroke-width", 3 * alpha)
                .attr("stroke-opacity", alpha * 0.7);
            }
          }
        }

        // Update team cluster hulls
        teamClusterGroup.selectAll("*").remove();
        for (const [teamId, teamNodes] of teamNodeMap) {
          const points = teamNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!] as [number, number]);
          if (points.length < 2) continue;
          const team = teams.get(teamId);
          const isSelectedTeam = teamId === selectedTeamId;
          const leader = teamNodes.find((n) => n.agent.agentType === "team-lead");
          const clusterColor = leader ? AGENT_COLORS[leader.agent.agentType] : UI.primary;

          if (points.length === 2) {
            // Draw an ellipse between two nodes
            const cx = (points[0][0] + points[1][0]) / 2;
            const cy = (points[0][1] + points[1][1]) / 2;
            const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
            const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
            teamClusterGroup.append("ellipse")
              .attr("cx", cx).attr("cy", cy)
              .attr("rx", rx).attr("ry", ry)
              .attr("fill", `${clusterColor}08`)
              .attr("stroke", clusterColor)
              .attr("stroke-width", isSelectedTeam ? 1.5 : 1)
              .attr("stroke-opacity", isSelectedTeam ? 0.5 : 0.2)
              .attr("stroke-dasharray", "6 3");
          } else {
            // Draw convex hull around team members
            const hull = d3.polygonHull(points);
            if (hull) {
              // Expand hull by collideRadius for padding
              const centroid = d3.polygonCentroid(hull);
              const expanded = hull.map(([x, y]) => {
                const dx = x - centroid[0];
                const dy = y - centroid[1];
                const dist = Math.sqrt(dx * dx + dy * dy);
                const pad = GRAPH.collideRadius;
                return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
              });
              teamClusterGroup.append("path")
                .attr("d", `M${expanded.map((p) => p.join(",")).join("L")}Z`)
                .attr("fill", `${clusterColor}08`)
                .attr("stroke", clusterColor)
                .attr("stroke-width", isSelectedTeam ? 1.5 : 1)
                .attr("stroke-opacity", isSelectedTeam ? 0.5 : 0.2)
                .attr("stroke-dasharray", "6 3")
                .attr("stroke-linejoin", "round");
            }
          }
          // Team label
          if (team && points.length >= 2) {
            const avgY = Math.min(...points.map((p) => p[1]));
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            teamClusterGroup.append("text")
              .attr("x", avgX)
              .attr("y", avgY - GRAPH.collideRadius - 8)
              .attr("text-anchor", "middle")
              .attr("fill", clusterColor)
              .attr("font-family", "monospace")
              .attr("font-size", 10)
              .attr("font-weight", "bold")
              .attr("opacity", isSelectedTeam ? 0.8 : 0.4)
              .text(team.name);
          }
        }
      });

    simulationRef.current = simulation;
    return () => { simulation.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, selectAgent]);

  // ── Effect 2: Update visuals in-place (no simulation restart) ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const d3svg = d3.select(svg);
    const nodeGroup = d3svg.select<SVGGElement>("g.nodes");
    if (nodeGroup.empty()) return;

    // Trigger visual effects for new events
    const newEntries = activity.slice(prevActivityLenRef.current);
    prevActivityLenRef.current = activity.length;

    for (const entry of newEntries) {
      let effectNode: SimNode | undefined;
      let effectType: "spawn" | "complete" | "error" | null = null;
      const evt = entry.event;

      switch (evt.type) {
        case "agent:register":
          effectNode = nodesRef.current.find(n => n.id === evt.agentId);
          effectType = "spawn";
          break;
        case "agent:complete":
          effectNode = nodesRef.current.find(n => n.id === evt.agentId);
          effectType = "complete";
          break;
        case "agent:status":
          if (evt.status === "error") {
            effectNode = nodesRef.current.find(n => n.id === evt.agentId);
            effectType = "error";
          }
          break;
      }

      if (effectNode && effectType && effectNode.x != null && effectNode.y != null) {
        const a = agents.get(effectNode.id);
        const color = a ? AGENT_COLORS[a.agentType] : UI.text.secondary;
        effectsRef.current.push({
          x: effectNode.x,
          y: effectNode.y,
          color,
          type: effectType,
          startTime: Date.now(),
          duration: effectType === "error" ? 800 : 1000,
        });
      }
    }

    // Re-render only nodes whose visual state has changed
    const allAgentsList = Array.from(agents.values());
    const heatmapScale = heatmapEnabled ? createHeatmapScale() : null;

    nodeGroup.selectAll<SVGGElement, SimNode>("g.node").each(function (d) {
      const latest = agents.get(d.id);
      if (!latest) return;
      // Build a lightweight hash of visual-relevant fields to skip unchanged nodes
      const lastTool = latest.toolCalls.length > 0 ? latest.toolCalls[latest.toolCalls.length - 1].tool : "";
      const hash = `${latest.status}|${latest.agentType}|${lastTool}|${latest.toolCalls.length}|${latest.inputTokens + latest.outputTokens}|${d.id === selectedAgentId}|${heatmapEnabled}|${heatmapMetric}`;
      const prev = d3.select(this).attr("data-hash");
      d.agent = latest;
      if (prev === hash) return; // skip re-render — nothing visual changed
      const g = d3.select(this);
      g.attr("data-hash", hash);
      g.selectAll("*").remove();
      if (heatmapEnabled && heatmapScale) {
        const metricValue = computeMetricValue(latest, heatmapMetric, allAgentsList);
        renderHeatmapNode(g, latest, metricValue, heatmapScale, d.id === selectedAgentId);
      } else {
        renderNodeVisuals(g, latest, selectedAgentId);
      }
    });

    // Heatmap legend
    d3svg.select("#heatmap-legend").remove();
    if (heatmapEnabled) {
      const svgSel = d3svg as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>;
      renderHeatmapLegend(svgSel, heatmapMetric, 16, svg.clientHeight - 60);
    }

    // Update link colors / dash patterns
    const linkGroup = d3.select(svg).select<SVGGElement>("g.links");
    if (!linkGroup.empty()) {
      updateLinkVisuals(
        linkGroup.selectAll<SVGPathElement, SimLink>("path.glow"),
        linkGroup.selectAll<SVGPathElement, SimLink>("path.main"),
        agents,
      );
    }
    // Animate particles on active links — only rebuild when active link set changes
    const particleGroup = d3.select(svg).select<SVGGElement>("g.particles");
    if (!particleGroup.empty()) {
      // Build a hash of active links to skip unnecessary DOM rebuilds
      const activeLinkIds: string[] = [];
      const linkGroup2 = d3svg.select<SVGGElement>("g.links");
      linkGroup2.selectAll<SVGPathElement, SimLink>("path.main").each(function (d) {
        const targetId = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(targetId);
        if (a && (a.status === "running" || a.status === "idle")) {
          const sourceId = typeof d.source === "string" ? d.source : d.source.id;
          activeLinkIds.push(`${sourceId}→${targetId}`);
        }
      });
      const particleHash = activeLinkIds.sort().join("|");
      const prevHash = particleGroup.attr("data-hash");
      if (prevHash !== particleHash) {
        particleGroup.attr("data-hash", particleHash);
        particleGroup.selectAll("*").remove();
        linkGroup2.selectAll<SVGPathElement, SimLink>("path.main").each(function (d) {
          const targetId = typeof d.target === "string" ? d.target : d.target.id;
          const a = agents.get(targetId);
          if (!a || (a.status !== "running" && a.status !== "idle")) return;

          const color = AGENT_COLORS[a.agentType];
          const source = d.source as SimNode;
          const target = d.target as SimNode;
          if (source.x == null || source.y == null || target.x == null || target.y == null) return;

          const pathD = bezierPath(source.x, source.y, target.x, target.y);

          for (let i = 0; i < 2; i++) {
            const particle = particleGroup.append("circle")
              .attr("r", GRAPH.particleRadius)
              .attr("fill", color)
              .attr("opacity", 0);

            particle.append("animateMotion")
              .attr("path", pathD)
              .attr("dur", `${GRAPH.particleSpeed}ms`)
              .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
              .attr("repeatCount", "indefinite");
            particle.append("animate")
              .attr("attributeName", "opacity")
              .attr("values", "0;0.8;0.8;0")
              .attr("dur", `${GRAPH.particleSpeed}ms`)
              .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
              .attr("repeatCount", "indefinite");
          }
        });
      }
    }
  }, [agents, selectedAgentId, activity, heatmapEnabled, heatmapMetric]);

  // ── Handle resize ──
  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      d3.select(svg).attr("width", width).attr("height", height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Effect: Apply non-force layouts ──
  useEffect(() => {
    const simulation = simulationRef.current;
    const container = containerRef.current;
    const svg = svgRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    if (!simulation || !container || !svg || nodes.length === 0) return;

    const { width, height } = container.getBoundingClientRect();

    if (graphLayout === "force") {
      // Unfix all nodes and restart simulation
      for (const n of nodes) {
        n.fx = null;
        n.fy = null;
      }
      simulation.alpha(0.5).restart();
    } else {
      // Stop simulation and apply layout
      simulation.stop();
      const layoutFn = graphLayout === "tree"
        ? applyTreeLayout
        : graphLayout === "radial"
          ? applyRadialLayout
          : applyHierarchicalLayout;
      layoutFn(nodes, links, width, height);

      // Update SVG positions directly
      const d3svg = d3.select(svg);
      d3svg.selectAll<SVGGElement, SimNode>("g.node")
        .attr("transform", (d) => `translate(${d.fx ?? d.x ?? 0}, ${d.fy ?? d.y ?? 0})`);
      const linkGroup = d3svg.select<SVGGElement>("g.links");
      if (!linkGroup.empty()) {
        linkGroup.selectAll<SVGPathElement, SimLink>("path.glow")
          .attr("d", (d) => bezierPath(
            ((d.source as SimNode).fx ?? (d.source as SimNode).x) ?? 0,
            ((d.source as SimNode).fy ?? (d.source as SimNode).y) ?? 0,
            ((d.target as SimNode).fx ?? (d.target as SimNode).x) ?? 0,
            ((d.target as SimNode).fy ?? (d.target as SimNode).y) ?? 0,
          ));
        linkGroup.selectAll<SVGPathElement, SimLink>("path.main")
          .attr("d", (d) => bezierPath(
            ((d.source as SimNode).fx ?? (d.source as SimNode).x) ?? 0,
            ((d.source as SimNode).fy ?? (d.source as SimNode).y) ?? 0,
            ((d.target as SimNode).fx ?? (d.target as SimNode).x) ?? 0,
            ((d.target as SimNode).fy ?? (d.target as SimNode).y) ?? 0,
          ));
      }
    }
  }, [graphLayout, topologyKey]);

  return (
    <div ref={containerRef} className="flex-1 h-full" style={{ background: "var(--color-bg)" }}>
      <svg ref={svgRef} style={{ display: "block" }} />
    </div>
  );
});
