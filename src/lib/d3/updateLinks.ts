import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import { EDGE_COLORS, UI, agentColor } from "@/lib/colors";
import type { AgentState } from "@/lib/types";
import { endpointId } from "./endpointId";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  agent: AgentState;
  /** Nesting depth (0 = main agent, 1 = direct sub-agent, …); computed at node-build time */
  depth?: number;
  /** Present only on tool-call nodes; undefined on agent nodes */
  toolCall?: { tool: string; timestamp: number; parentAgentId: string };
  /** Real workflow label (e.g. "find:A-line-scan") for nodes that belong to a
   *  workflow run; rendered verbatim under the hex instead of the type label. */
  workflowLabel?: string;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  edgeType?: "parent" | "message" | "blocking" | "tool";
  /** Cached path from the last linkPath() call — lets glow/main pairs share one computation */
  pathD?: string;
}

/* ── Straight line path between two points ───────────────── */
export function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M${sx},${sy} L${tx},${ty}`;
}

/**
 * Path for a link whose endpoints have been resolved to SimNodes by
 * forceLink. Prefers fx/fy so it works in both force mode (the simulation
 * copies fx into x each tick) and the static tree/radial/hierarchical
 * layouts (which set only fx/fy, leaving x/y stale).
 */
export function linkPath(d: SimLink): string {
  const s = d.source as SimNode;
  const t = d.target as SimNode;
  return bezierPath(
    (s.fx ?? s.x) ?? 0, (s.fy ?? s.y) ?? 0,
    (t.fx ?? t.x) ?? 0, (t.fy ?? t.y) ?? 0,
  );
}

/**
 * Update link stroke colors, dash styles, opacity, and flow animations
 * based on current agent status. Message edges render in amber with a
 * dotted pattern; parent edges animate when the child agent is active.
 */
export function updateLinkVisuals<E extends SVGElement>(
  linkGlow: Selection<E, SimLink, SVGGElement, unknown>,
  linkLine: Selection<E, SimLink, SVGGElement, unknown>,
  agents: Map<string, AgentState>,
) {
  linkGlow.attr("stroke", (d) => {
    if (d.edgeType === "message") {
      return UI.tool; // amber for message edges
    }
    const a = agents.get(endpointId(d.target));
    return a ? agentColor(a) : UI.text.secondary;
  });
  linkLine
    .attr("stroke", (d) => {
      if (d.edgeType === "message") {
        return UI.tool;
      }
      const a = agents.get(endpointId(d.target));
      return a ? agentColor(a) : UI.text.secondary;
    })
    .attr("stroke-dasharray", (d) => {
      if (d.edgeType === "message") return "4 3";
      const a = agents.get(endpointId(d.target));
      const active = a?.status === "running" || a?.status === "idle";
      return active ? "8 4" : "none";
    })
    .each(function (d) {
      const a = agents.get(endpointId(d.target));
      const line = select(this);
      // Remove existing animate children before adding new ones
      line.selectAll("animate").remove();
      if (d.edgeType !== "message" && a?.status === "running") {
        line.append("animate")
          .attr("attributeName", "stroke-dashoffset")
          .attr("values", "24;0")
          .attr("dur", "0.8s")
          .attr("repeatCount", "indefinite");
      }
    });

  linkLine.attr("stroke-opacity", (d) => {
    if (d.edgeType === "message") return 0.5;
    const a = agents.get(endpointId(d.target));
    const finished = a?.status === "completed" || a?.status === "error";
    return finished ? 0.2 : 0.6;
  });

  linkGlow.attr("stroke-opacity", (d) => {
    if (d.edgeType === "message") return 0.05;
    const a = agents.get(endpointId(d.target));
    const finished = a?.status === "completed" || a?.status === "error";
    return finished ? 0.03 : 0.1;
  });
}
