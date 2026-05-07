"use client";

import { useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, EDGE_COLORS, UI, agentColor } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { GRAPH, getNodeRadius } from "@/lib/config";
import { renderNodeVisuals, updateLinkVisuals, hexPath, bezierPath, renderHeatmapNode, renderHeatmapLegend, computeMetricValue, precomputeHeatmapNorms, createHeatmapScale } from "@/lib/d3";
import type { SimNode, SimLink } from "@/lib/d3";
import type { AgentState, GraphLayout } from "@/lib/types";
import { applyTreeLayout, applyRadialLayout, applyHierarchicalLayout } from "@/lib/d3/layouts";

export interface AgentGraphHandle {
  fitToView(): void;
  getNodesAndViewport(): {
    nodes: Array<{ x: number; y: number; color: string }>;
    viewport: { x: number; y: number; width: number; height: number };
  } | null;
}

/* ── Component ─────────────────────────────────────────── */
export const AgentGraph = forwardRef<AgentGraphHandle>(function AgentGraph(_props, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const toolNodesRef = useRef<SimNode[]>([]);
  const toolLinksRef = useRef<SimLink[]>([]);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const effectsRef = useRef<Array<{
    x: number;
    y: number;
    color: string;
    type: "spawn" | "complete" | "error";
    startTime: number;
    duration: number;
    effectRadius: number;
  }>>([]);
  const prevActivityLenRef = useRef(0);

  const fitToView = useCallback((duration = 500) => {
    const svg = svgRef.current;
    const container = containerRef.current;
    const zoom = zoomRef.current;
    const nodes = nodesRef.current;
    if (!svg || !container || !zoom || nodes.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const paddingX = width * 0.20;
    const paddingY = height * 0.20;

    // Calculate bounding box of all nodes (including visual extent)
    const nodeExtent = GRAPH.nodeRadius + 80; // account for labels, satellites, text below
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x - nodeExtent);
        minY = Math.min(minY, n.y - nodeExtent);
        maxX = Math.max(maxX, n.x + nodeExtent);
        maxY = Math.max(maxY, n.y + nodeExtent);
      }
    }
    if (!isFinite(minX)) return;

    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const scale = Math.min(
      (width - paddingX * 2) / bboxW,
      (height - paddingY * 2) / bboxH,
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
      .duration(duration)
      // D3's zoom.transform overload doesn't match Transition types exactly — safe cast
      .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
  }, []);

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
          color: agentColor(n.agent),
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
    fitToView: () => fitToView(),
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

  // Auto-fit whenever the topology changes. Wait briefly for the force
  // simulation to settle so we fit the final layout, not the spawn positions.
  useEffect(() => {
    if (!topologyKey) return;
    const timer = setTimeout(() => fitToView(), 700);
    return () => clearTimeout(timer);
  }, [topologyKey, fitToView]);

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

    // Tool links rendered behind agent links for visual hierarchy
    canvas.append("g").attr("class", "tool-links");

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

    // Tool nodes rendered behind agent nodes
    canvas.append("g").attr("class", "tool-nodes");

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
      .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => {
        const link = d as SimLink;
        if (link.edgeType === "tool") return GRAPH.toolLinkDistance;
        if (link.edgeType === "parent") return GRAPH.subAgentLinkDistance;
        return GRAPH.linkDistance;
      }))
      .force("charge", d3.forceManyBody<SimNode>().strength((d) =>
        d.toolCall ? -80 : GRAPH.chargeStrength
      ))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius((d) => {
        if (d.toolCall) return GRAPH.toolNodeRadius + 4;
        const isSub = !!(d.agent.parentId && !d.agent.teamId);
        return isSub ? GRAPH.subAgentCollideRadius : GRAPH.collideRadius;
      }))
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

        // Update tool node positions
        canvas.select<SVGGElement>("g.tool-nodes")
          .selectAll<SVGGElement, SimNode>("g.tool-node")
          .attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);

        // Update tool link endpoints (source/target resolved to objects by forceLink)
        canvas.select<SVGGElement>("g.tool-links")
          .selectAll<SVGLineElement, SimLink>("line")
          .each(function (d) {
            const s = d.source as SimNode;
            const t = d.target as SimNode;
            if (s?.x == null || t?.x == null) return;
            const dx = t.x! - s.x!;
            const dy = t.y! - s.y!;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            d3.select(this)
              .attr("x1", s.x!).attr("y1", s.y!)
              .attr("x2", t.x! - ux * GRAPH.toolNodeRadius)
              .attr("y2", t.y! - uy * GRAPH.toolNodeRadius);
          });

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
              const er = effect.effectRadius + progress * 40;
              effectsGroup.append("path")
                .attr("d", hexPath(er))
                .attr("transform", `translate(${effect.x},${effect.y})`)
                .attr("fill", "none")
                .attr("stroke", effect.color)
                .attr("stroke-width", 2 * alpha)
                .attr("stroke-opacity", alpha * 0.6);
            } else if (effect.type === "complete") {
              // Bright expanding ring
              const er = effect.effectRadius + progress * 60;
              effectsGroup.append("circle")
                .attr("cx", effect.x)
                .attr("cy", effect.y)
                .attr("r", er)
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
                  .attr("r", effect.effectRadius)
                  .attr("fill", "white")
                  .attr("opacity", flashAlpha * 0.15);
              }
            } else if (effect.type === "error") {
              // Red pulse glow
              const er = effect.effectRadius + progress * 30;
              effectsGroup.append("circle")
                .attr("cx", effect.x)
                .attr("cy", effect.y)
                .attr("r", er)
                .attr("fill", "none")
                .attr("stroke", UI.error)
                .attr("stroke-width", 3 * alpha)
                .attr("stroke-opacity", alpha * 0.7);
            }
          }
        }

        // Update team cluster hulls — join by team id and update in place
        // to avoid a full remove/re-append on every simulation tick.
        const teamEntries = Array.from(teamNodeMap.entries()).filter(([, ns]) =>
          ns.filter((n) => n.x != null && n.y != null).length >= 2,
        );
        const teamGroups = teamClusterGroup
          .selectAll<SVGGElement, [string, SimNode[]]>("g.team")
          .data(teamEntries, (d) => d[0]);
        teamGroups.exit().remove();
        const teamEnter = teamGroups.enter().append("g").attr("class", "team");
        teamEnter.append("path").attr("class", "cluster-shape");
        teamEnter.append("text").attr("class", "cluster-label")
          .attr("text-anchor", "middle")
          .attr("font-family", "monospace")
          .attr("font-size", 10)
          .attr("font-weight", "bold");
        const teamMerged = teamEnter.merge(teamGroups);

        teamMerged.each(function ([teamId, teamNodes]) {
          const g = d3.select(this);
          const points = teamNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!] as [number, number]);
          const team = teams.get(teamId);
          const isSelectedTeam = teamId === selectedTeamId;
          const leader = teamNodes.find((n) => n.agent.agentType === "team-lead");
          const clusterColor = leader ? agentColor(leader.agent) : UI.primary;

          let d = "";
          if (points.length === 2) {
            const cx = (points[0][0] + points[1][0]) / 2;
            const cy = (points[0][1] + points[1][1]) / 2;
            const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
            const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
            // Ellipse as SVG path
            d = `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`;
          } else {
            const hull = d3.polygonHull(points);
            if (hull) {
              const centroid = d3.polygonCentroid(hull);
              const expanded = hull.map(([x, y]) => {
                const dx = x - centroid[0];
                const dy = y - centroid[1];
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const pad = GRAPH.collideRadius;
                return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
              });
              d = `M${expanded.map((p) => p.join(",")).join("L")}Z`;
            }
          }

          g.select<SVGPathElement>("path.cluster-shape")
            .attr("d", d)
            .attr("fill", `${clusterColor}08`)
            .attr("stroke", clusterColor)
            .attr("stroke-width", isSelectedTeam ? 1.5 : 1)
            .attr("stroke-opacity", isSelectedTeam ? 0.5 : 0.2)
            .attr("stroke-dasharray", "6 3")
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.cluster-label");
          if (team) {
            // Avoid Math.min(...spread) — fold to stay stack-safe with
            // arbitrarily many cluster points.
            let avgY = Infinity;
            for (const p of points) if (p[1] < avgY) avgY = p[1];
            if (avgY === Infinity) avgY = 0;
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            label
              .attr("x", avgX)
              .attr("y", avgY - GRAPH.collideRadius - 8)
              .attr("fill", clusterColor)
              .attr("opacity", isSelectedTeam ? 0.8 : 0.4)
              .text(team.name);
          } else {
            label.text("");
          }
        });
      });

    // Auto fit-to-view after simulation has had time to lay out nodes.
    // Skip if the user has already panned/zoomed — don't fight a manual gesture.
    const fitTimer = setTimeout(() => {
      const svg = svgRef.current;
      const container = containerRef.current;
      const zoom = zoomRef.current;
      if (!svg || !container || !zoom || nodes.length === 0) return;
      const currentTransform = d3.zoomTransform(svg);
      if (currentTransform.k !== 1 || currentTransform.x !== 0 || currentTransform.y !== 0) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const padX = w * 0.20;
      const padY = h * 0.20;
      const nodeExtent = GRAPH.nodeRadius + 80;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          minX = Math.min(minX, n.x - nodeExtent);
          minY = Math.min(minY, n.y - nodeExtent);
          maxX = Math.max(maxX, n.x + nodeExtent);
          maxY = Math.max(maxY, n.y + nodeExtent);
        }
      }
      if (!isFinite(minX)) return;
      const bboxW = maxX - minX || 1;
      const bboxH = maxY - minY || 1;
      const scale = Math.min(
        (w - padX * 2) / bboxW,
        (h - padY * 2) / bboxH,
        GRAPH.zoomExtent[1],
      );
      const clampedScale = Math.max(GRAPH.zoomExtent[0], Math.min(scale, GRAPH.zoomExtent[1]));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const transform = d3.zoomIdentity.translate(w / 2, h / 2).scale(clampedScale).translate(-cx, -cy);
      d3.select(svg).transition().duration(500)
        .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
    }, 1500);

    simulationRef.current = simulation;
    return () => { simulation.stop(); clearTimeout(fitTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, selectAgent]);

  // ── Effect 2a: Dispatch lifecycle effects from new activity entries (cheap) ──
  useEffect(() => {
    if (activity.length === 0) return;
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
        const color = a ? agentColor(a) : UI.text.secondary;
        const effectRadius = a ? getNodeRadius(a) : GRAPH.nodeRadius;
        effectsRef.current.push({
          x: effectNode.x,
          y: effectNode.y,
          color,
          type: effectType,
          startTime: Date.now(),
          duration: effectType === "error" ? 800 : 1000,
          effectRadius,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  // ── Effect 2b: Update node visuals in-place (expensive DOM walk) ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const d3svg = d3.select(svg);
    const nodeGroup = d3svg.select<SVGGElement>("g.nodes");
    if (nodeGroup.empty()) return;

    // Re-render only nodes whose visual state has changed
    const allAgentsList = Array.from(agents.values());
    const heatmapScale = heatmapEnabled ? createHeatmapScale() : null;
    const heatmapNorms = heatmapEnabled ? precomputeHeatmapNorms(allAgentsList) : null;

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
      if (heatmapEnabled && heatmapScale && heatmapNorms) {
        const metricValue = computeMetricValue(latest, heatmapMetric, heatmapNorms);
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

          const color = agentColor(a);
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
  }, [agents, selectedAgentId, heatmapEnabled, heatmapMetric]);

  // ── Effect 3: Sync tool call nodes with force simulation ──
  useEffect(() => {
    const simulation = simulationRef.current;
    const svg = svgRef.current;
    if (!simulation || !svg) return;

    const now = Date.now();
    const newToolNodes: SimNode[] = [];
    const newToolLinks: SimLink[] = [];

    // Only emit tool links for agents currently in the force graph.
    // Otherwise d3-force throws "node not found" when a link's source
    // references an agent that was filtered out of nodesRef.
    const visibleAgentIds = new Set(nodesRef.current.map((n) => n.id));

    for (const [agentId, agent] of agents) {
      if (!visibleAgentIds.has(agentId)) continue;
      if (agent.status !== "running" && agent.status !== "idle") continue;
      const recentCalls = agent.toolCalls
        .filter((tc) => now - tc.timestamp < GRAPH.toolWindowMs)
        .slice(-GRAPH.toolMaxPerAgent);

      for (const tc of recentCalls) {
        const toolNodeId = `tool:${agentId}:${tc.timestamp}`;
        const existing = toolNodesRef.current.find((n) => n.id === toolNodeId);
        const parentNode = nodesRef.current.find((n) => n.id === agentId);
        const toolNode: SimNode = existing ?? {
          id: toolNodeId,
          agent,
          toolCall: { tool: tc.tool, timestamp: tc.timestamp, parentAgentId: agentId },
          // Spawn near parent so the link spring pulls them into place
          x: (parentNode?.x ?? 0) + (Math.random() - 0.5) * 20,
          y: (parentNode?.y ?? 0) + (Math.random() - 0.5) * 20,
        };
        if (existing) existing.agent = agent;
        newToolNodes.push(toolNode);
        newToolLinks.push({ source: agentId, target: toolNodeId, edgeType: "tool" });
      }
    }

    // Only disturb the simulation when the node set actually changes
    const prevIds = new Set(toolNodesRef.current.map((n) => n.id));
    const newIds = new Set(newToolNodes.map((n) => n.id));
    const changed = prevIds.size !== newIds.size || [...newIds].some((id) => !prevIds.has(id));

    toolNodesRef.current = newToolNodes;
    toolLinksRef.current = newToolLinks;

    // Always refresh the simulation's view of tool nodes/links. The brand-new
    // link objects built above still have string source/target refs; without
    // this call d3 never resolves them to SimNode objects, which leaves the
    // tick handler unable to update line endpoints (causing orphaned dashed
    // lines and detached tool circles). Only restart alpha when the node set
    // actually changed, to avoid constant layout jitter.
    simulation.nodes([...nodesRef.current, ...newToolNodes]);
    const linkForce = simulation.force<d3.ForceLink<SimNode, SimLink>>("link");
    if (linkForce) linkForce.links([...linksRef.current, ...newToolLinks]);
    if (changed) {
      simulation.alpha(Math.max(simulation.alpha(), 0.1)).restart();
    }

    // Sync tool link SVG elements
    const canvas = d3.select(svg).select<SVGGElement>("g.canvas");
    const toolLinkGroup = canvas.select<SVGGElement>("g.tool-links");
    if (!toolLinkGroup.empty()) {
      toolLinkGroup
        .selectAll<SVGLineElement, SimLink>("line")
        .data(newToolLinks, (d) => {
          const t = typeof d.target === "string" ? d.target : (d.target as SimNode).id;
          return t;
        })
        .join("line")
        .attr("stroke", (d) => {
          const sourceId = typeof d.source === "string" ? d.source : (d.source as SimNode).id;
          const agent = agents.get(sourceId);
          const color = agent ? agentColor(agent) : UI.text.secondary;
          return `${color}66`;
        })
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "3 2")
        .each(function (d) {
          const line = d3.select(this);
          line.selectAll("animate").remove();
          const sourceId = typeof d.source === "string" ? d.source : (d.source as SimNode).id;
          const targetNode = typeof d.target === "string" ? null : (d.target as SimNode);
          const agent = agents.get(sourceId);
          if (!targetNode?.toolCall || agent?.status !== "running") return;
          // Animate only the most-recent tool call link.
          // Fold instead of Math.max(...spread) — toolCalls is capped to
          // MAX_TOOL_CALLS_PER_AGENT today, but the spread form is one
          // refactor away from a stack overflow if the cap ever moves.
          let latestTs = -Infinity;
          for (const tc of agent.toolCalls) if (tc.timestamp > latestTs) latestTs = tc.timestamp;
          if (targetNode.toolCall.timestamp !== latestTs) return;
          line.append("animate")
            .attr("attributeName", "stroke-dashoffset")
            .attr("values", "10;0")
            .attr("dur", "0.6s")
            .attr("repeatCount", "indefinite");
        });
    }

    // Sync tool node SVG elements
    const toolNodeGroup = canvas.select<SVGGElement>("g.tool-nodes");
    if (!toolNodeGroup.empty()) {
      toolNodeGroup
        .selectAll<SVGGElement, SimNode>("g.tool-node")
        .data(newToolNodes, (d) => d.id)
        .join(
          (enter) => {
            const g = enter.append("g").attr("class", "tool-node").attr("cursor", "pointer");

            // TODO: implement renderToolNode(g, d) here for custom tool node appearance
            // The function receives the <g> selection and the SimNode (d.toolCall has tool name + timestamp)
            // Default rendering below — feel free to replace with your own style:
            g.each(function (d) {
              const color = agentColor(d.agent);
              // Tool nodes only emit for running|idle parents; dim the idle
              // ones so live tool calls pop against stale / between-turn ones.
              const dim = d.agent.status !== "running";
              const displayName = d.toolCall!.tool.length > 6
                ? d.toolCall!.tool.slice(0, 5) + "\u2026"
                : d.toolCall!.tool;
              d3.select(this).append("circle")
                .attr("r", GRAPH.toolNodeRadius)
                .attr("fill", dim ? `${color}08` : `${color}14`)
                .attr("stroke", dim ? `${color}33` : `${color}66`)
                .attr("stroke-width", 1);
              d3.select(this).append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("fill", dim ? `${color}55` : `${color}aa`)
                .attr("font-family", "monospace")
                .attr("font-size", 7)
                .style("pointer-events", "none")
                .text(displayName);
            });

            // Tool nodes are draggable just like agent nodes
            g.call(
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
            return g;
          },
          (update) => update,
          (exit) => exit.remove()
        );
    }
  }, [agents]);

  // ── Handle resize ──
  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      d3.select(svg).attr("width", width).attr("height", height);
      fitToView(250);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToView]);

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
