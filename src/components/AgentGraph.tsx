"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { getTokenPercent } from "@/lib/utils";
import type { AgentState } from "@/lib/types";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  agent: AgentState;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export function AgentGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const agents = useAgentStore((s) => s.agents);
  const storeEdges = useAgentStore((s) => s.edges);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const filteredAgents = useFilteredAgents();

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const d3svg = d3.select(svg).attr("width", width).attr("height", height);
    d3svg.selectAll("*").remove();

    // Build data
    const agentIds = new Set(filteredAgents.map((a) => a.id));
    const nodes: SimNode[] = filteredAgents.map((a) => ({ id: a.id, agent: a }));
    const links: SimLink[] = storeEdges
      .filter((e) => agentIds.has(e.source) && agentIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    if (nodes.length === 0) {
      d3svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#444")
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

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => {
        canvas.attr("transform", event.transform);
      });
    d3svg.call(zoom);

    // Link groups (glow + main line)
    const linkGroup = canvas.append("g").attr("class", "links");
    const linkGlow = linkGroup.selectAll<SVGLineElement, SimLink>("line.glow")
      .data(links)
      .join("line")
      .attr("class", "glow")
      .attr("stroke", (d) => {
        const t = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(t);
        return a ? AGENT_COLORS[a.agentType] : "#94a3b8";
      })
      .attr("stroke-width", 6)
      .attr("stroke-opacity", 0.1);

    const linkLine = linkGroup.selectAll<SVGLineElement, SimLink>("line.main")
      .data(links)
      .join("line")
      .attr("class", "main")
      .attr("stroke", (d) => {
        const t = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(t);
        return a ? AGENT_COLORS[a.agentType] : "#94a3b8";
      })
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", (d) => {
        const t = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(t);
        return a?.status === "running" ? "8 4" : "none";
      });

    // Node groups
    const nodeGroup = canvas.append("g").attr("class", "nodes");
    const node = nodeGroup.selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => selectAgent(d.agent.id));

    // Draw each node's visuals
    node.each(function (d) {
      const g = d3.select(this);
      const agent = d.agent;
      const color = AGENT_COLORS[agent.agentType] || "#94a3b8";
      const statusColor = STATUS_COLORS[agent.status] || "#6b7280";
      const label = AGENT_LABELS[agent.agentType] || "AGENT";
      const tokenPercent = getTokenPercent(agent);
      const isSelected = agent.id === selectedAgentId;
      const isActive = agent.status === "running";

      const lastTool = agent.toolCalls.length > 0
        ? agent.toolCalls[agent.toolCalls.length - 1].tool
        : null;
      const statusLabel = isActive && lastTool
        ? lastTool
        : agent.status === "idle" ? "sleep" : agent.status;

      // Outer glow ring for selected/active
      if (isSelected || isActive) {
        g.append("circle")
          .attr("r", 28)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", isSelected ? 2 : 1)
          .attr("stroke-opacity", 0.3)
          .attr("filter", "url(#glow)");
      }

      // Main circle
      g.append("circle")
        .attr("r", 22)
        .attr("fill", `${color}22`)
        .attr("stroke", color)
        .attr("stroke-width", 2);

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
      const barW = 40;
      const barH = 3;
      const barY = 42;
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
      const statusY = 54;
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

      // Task tooltip (above node)
      if (agent.task) {
        const taskText = agent.task.slice(0, 36) + (agent.task.length > 36 ? "..." : "");
        const estW = Math.min(taskText.length * 7 + 16, 280);
        const tooltipG = g.append("g").attr("transform", "translate(0, -38)");
        tooltipG.append("rect")
          .attr("x", -estW / 2).attr("y", -12)
          .attr("width", estW).attr("height", 22)
          .attr("rx", 4)
          .attr("fill", "#1a1a2e")
          .attr("stroke", `${color}33`)
          .attr("stroke-width", 1);
        tooltipG.append("text")
          .attr("text-anchor", "middle").attr("y", 3)
          .attr("fill", "#c9d1d9")
          .attr("font-family", "monospace")
          .attr("font-size", 11)
          .style("pointer-events", "none")
          .text(taskText);
      }
    });

    // Drag behavior
    function dragstarted(event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    function dragged(event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    function dragended(event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    node.call(
      d3.drag<SVGGElement, SimNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended)
    );

    // Force simulation
    const simulation = d3.forceSimulation<SimNode, SimLink>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(160))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius(60))
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

        node.attr("transform", (d) => `translate(${d.x}, ${d.y})`);
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [filteredAgents, storeEdges, agents, selectedAgentId, selectAgent]);

  // Handle resize
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
}
