"use client";

import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { getTokenPercent } from "@/lib/utils";
import { GRAPH } from "@/lib/config";
import type { AgentState, EdgeState, TeamState } from "@/lib/types";

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
  edgeType?: "parent" | "message";
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
    const barW = GRAPH.sparklineWidth / GRAPH.sparklineBuckets;
    const sparkG = g.append("g")
      .attr("transform", `translate(${-GRAPH.sparklineWidth / 2}, ${GRAPH.sparklineY})`);
    for (let i = 0; i < GRAPH.sparklineBuckets; i++) {
      const h = (buckets[i] / maxVal) * GRAPH.sparklineHeight;
      sparkG.append("rect")
        .attr("x", i * barW)
        .attr("y", GRAPH.sparklineHeight - h)
        .attr("width", barW - 0.5)
        .attr("height", h)
        .attr("fill", color)
        .attr("opacity", 0.6);
    }
  }

}

/* ── Update link stroke colors and dash styles ─────────── */
function updateLinkVisuals(
  linkGlow: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>,
  linkLine: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>,
  agents: Map<string, AgentState>,
) {
  const getTargetId = (d: SimLink) =>
    typeof d.target === "string" ? d.target : d.target.id;
  const getSourceId = (d: SimLink) =>
    typeof d.source === "string" ? d.source : d.source.id;

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
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

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
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const filteredAgents = useFilteredAgents();

  // Topology key — only changes when agents join/leave, parent links change, or edges change.
  // This controls when the force simulation is rebuilt.
  const topologyKey = useMemo(() => {
    const agentKeys = filteredAgents
      .map((a) => `${a.id}:${a.parentId || ""}:${a.teamId || ""}`)
      .sort()
      .join("|");
    const edgeKeys = edges
      .filter((e) => e.edgeType === "message")
      .map((e) => `m:${e.source}:${e.target}`)
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
    const links: SimLink[] = [...parentLinks, ...messageLinks];

    nodesRef.current = nodes;

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

    // Canvas group for zoom/pan
    const canvas = d3svg.append("g").attr("class", "canvas");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH.zoomExtent)
      .on("zoom", (event) => canvas.attr("transform", event.transform));
    d3svg.call(zoom);
    zoomRef.current = zoom;

    // Team cluster backgrounds (rendered first so they appear behind everything)
    const teamClusterGroup = canvas.append("g").attr("class", "team-clusters");

    // Link groups (glow + main line)
    const linkGroup = canvas.append("g").attr("class", "links");
    linkGroup.selectAll<SVGLineElement, SimLink>("line.glow")
      .data(links).join("line").attr("class", (d) => `glow ${d.edgeType || "parent"}`)
      .attr("stroke-width", 6).attr("stroke-opacity", 0.1);
    linkGroup.selectAll<SVGLineElement, SimLink>("line.main")
      .data(links).join("line").attr("class", (d) => `main ${d.edgeType || "parent"}`)
      .attr("stroke-width", (d) => d.edgeType === "message" ? 1.5 : 2)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", (d) => d.edgeType === "message" ? "4 3" : "none");

    // Apply initial link colors
    updateLinkVisuals(
      linkGroup.selectAll<SVGLineElement, SimLink>("line.glow"),
      linkGroup.selectAll<SVGLineElement, SimLink>("line.main"),
      agents,
    );

    // Particle group for link flow animation
    canvas.append("g").attr("class", "particles");

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
    const linkGlow = linkGroup.selectAll<SVGLineElement, SimLink>("line.glow");
    const linkLine = linkGroup.selectAll<SVGLineElement, SimLink>("line.main");

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
        linkGlow
          .attr("x1", (d) => (d.source as SimNode).x!)
          .attr("y1", (d) => (d.source as SimNode).y!)
          .attr("x2", (d) => (d.target as SimNode).x!)
          .attr("y2", (d) => (d.target as SimNode).y!);
        linkLine
          .attr("x1", (d) => (d.source as SimNode).x!)
          .attr("y1", (d) => (d.source as SimNode).y!)
          .attr("x2", (d) => (d.target as SimNode).x!)
          .attr("y2", (d) => (d.target as SimNode).y!);
        nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y})`);

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

    // Re-render only nodes whose visual state has changed
    nodeGroup.selectAll<SVGGElement, SimNode>("g.node").each(function (d) {
      const latest = agents.get(d.id);
      if (!latest) return;
      // Build a lightweight hash of visual-relevant fields to skip unchanged nodes
      const lastTool = latest.toolCalls.length > 0 ? latest.toolCalls[latest.toolCalls.length - 1].tool : "";
      const hash = `${latest.status}|${latest.agentType}|${lastTool}|${latest.toolCalls.length}|${latest.inputTokens + latest.outputTokens}|${d.id === selectedAgentId}`;
      const prev = d3.select(this).attr("data-hash");
      d.agent = latest;
      if (prev === hash) return; // skip re-render — nothing visual changed
      const g = d3.select(this);
      g.attr("data-hash", hash);
      g.selectAll("*").remove();
      renderNodeVisuals(g, latest, selectedAgentId);
    });

    // Update link colors / dash patterns
    const linkGroup = d3svg.select<SVGGElement>("g.links");
    if (!linkGroup.empty()) {
      updateLinkVisuals(
        linkGroup.selectAll<SVGLineElement, SimLink>("line.glow"),
        linkGroup.selectAll<SVGLineElement, SimLink>("line.main"),
        agents,
      );
    }
    // Animate particles on active links
    const particleGroup = d3svg.select<SVGGElement>("g.particles");
    if (!particleGroup.empty()) {
      particleGroup.selectAll("*").remove();
      const linkGroup = d3svg.select<SVGGElement>("g.links");
      linkGroup.selectAll<SVGLineElement, SimLink>("line.main").each(function (d) {
        const targetId = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(targetId);
        if (!a || (a.status !== "running" && a.status !== "idle")) return;

        const color = AGENT_COLORS[a.agentType];
        const source = d.source as SimNode;
        const target = d.target as SimNode;
        if (source.x == null || source.y == null || target.x == null || target.y == null) return;

        for (let i = 0; i < 2; i++) {
          const particle = particleGroup.append("circle")
            .attr("r", GRAPH.particleRadius)
            .attr("fill", color)
            .attr("opacity", 0);

          particle.append("animate")
            .attr("attributeName", "cx")
            .attr("values", `${source.x};${target.x}`)
            .attr("dur", `${GRAPH.particleSpeed}ms`)
            .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
            .attr("repeatCount", "indefinite");
          particle.append("animate")
            .attr("attributeName", "cy")
            .attr("values", `${source.y};${target.y}`)
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
  }, [agents, selectedAgentId]);

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

  return (
    <div ref={containerRef} className="flex-1 h-full" style={{ background: "var(--color-bg)" }}>
      <svg ref={svgRef} style={{ display: "block" }} />
    </div>
  );
});
