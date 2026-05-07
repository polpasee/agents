import { useEffect } from "react";
import * as d3 from "d3";
import { UI, agentColor } from "@/lib/colors";
import { GRAPH } from "@/lib/config";
import type { SimNode, SimLink } from "@/lib/d3";
import type { AgentState } from "@/lib/types";
import type { AgentGraphRefs } from "./refs";

interface Options {
  agents: Map<string, AgentState>;
}

/**
 * Effect 3: sync transient tool-call nodes/links into the force simulation
 * and render their SVG. Runs whenever `agents` identity changes.
 *
 * Reads:  agents (prop), nodesRef, simulationRef, svgRef
 * Writes: toolNodesRef, toolLinksRef, simulation.nodes()/links(), tool-link
 *         and tool-node SVG groups
 */
export function useToolNodesEffect(refs: AgentGraphRefs, opts: Options) {
  const { agents } = opts;

  useEffect(() => {
    const simulation = refs.simulationRef.current;
    const svg = refs.svgRef.current;
    if (!simulation || !svg) return;

    const now = Date.now();
    const newToolNodes: SimNode[] = [];
    const newToolLinks: SimLink[] = [];

    // Only emit tool links for agents currently in the force graph.
    // Otherwise d3-force throws "node not found" when a link's source
    // references an agent that was filtered out of nodesRef.
    const visibleAgentIds = new Set(refs.nodesRef.current.map((n) => n.id));

    for (const [agentId, agent] of agents) {
      if (!visibleAgentIds.has(agentId)) continue;
      if (agent.status !== "running" && agent.status !== "idle") continue;
      const recentCalls = agent.toolCalls
        .filter((tc) => now - tc.timestamp < GRAPH.toolWindowMs)
        .slice(-GRAPH.toolMaxPerAgent);

      for (const tc of recentCalls) {
        const toolNodeId = `tool:${agentId}:${tc.timestamp}`;
        const existing = refs.toolNodesRef.current.find((n) => n.id === toolNodeId);
        const parentNode = refs.nodesRef.current.find((n) => n.id === agentId);
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
    const prevIds = new Set(refs.toolNodesRef.current.map((n) => n.id));
    const newIds = new Set(newToolNodes.map((n) => n.id));
    const changed = prevIds.size !== newIds.size || [...newIds].some((id) => !prevIds.has(id));

    refs.toolNodesRef.current = newToolNodes;
    refs.toolLinksRef.current = newToolLinks;

    // Always refresh the simulation's view of tool nodes/links. The brand-new
    // link objects built above still have string source/target refs; without
    // this call d3 never resolves them to SimNode objects, which leaves the
    // tick handler unable to update line endpoints (causing orphaned dashed
    // lines and detached tool circles). Only restart alpha when the node set
    // actually changed, to avoid constant layout jitter.
    simulation.nodes([...refs.nodesRef.current, ...newToolNodes]);
    const linkForce = simulation.force<d3.ForceLink<SimNode, SimLink>>("link");
    if (linkForce) linkForce.links([...refs.linksRef.current, ...newToolLinks]);
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
                ? d.toolCall!.tool.slice(0, 5) + "…"
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
  }, [refs, agents]);
}
