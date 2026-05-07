import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import { EDGE_COLORS, UI, agentColor } from "@/lib/colors";
import type { AgentState } from "@/lib/types";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  agent: AgentState;
  /** Present only on tool-call nodes; undefined on agent nodes */
  toolCall?: { tool: string; timestamp: number; parentAgentId: string };
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  edgeType?: "parent" | "message" | "blocking" | "tool";
}

/* ── Straight line path between two points ───────────────── */
export function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M${sx},${sy} L${tx},${ty}`;
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
  const getTargetId = (d: SimLink) =>
    typeof d.target === "string" ? d.target : d.target.id;

  linkGlow.attr("stroke", (d) => {
    if (d.edgeType === "message") {
      return UI.tool; // amber for message edges
    }
    const a = agents.get(getTargetId(d));
    return a ? agentColor(a) : UI.text.secondary;
  });
  linkLine
    .attr("stroke", (d) => {
      if (d.edgeType === "message") {
        return UI.tool;
      }
      const a = agents.get(getTargetId(d));
      return a ? agentColor(a) : UI.text.secondary;
    })
    .attr("stroke-dasharray", (d) => {
      if (d.edgeType === "message") return "4 3";
      const a = agents.get(getTargetId(d));
      const active = a?.status === "running" || a?.status === "idle";
      return active ? "8 4" : "none";
    })
    .each(function (d) {
      const a = agents.get(getTargetId(d));
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
