import * as d3 from "d3";
import { AGENT_COLORS, EDGE_COLORS, UI } from "@/lib/colors";
import type { AgentState } from "@/lib/types";

export interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  agent: AgentState;
}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  edgeType?: "parent" | "message" | "blocking";
}

/**
 * Update link stroke colors, dash styles, opacity, and flow animations
 * based on current agent status. Message edges render in amber with a
 * dotted pattern; parent edges animate when the child agent is active.
 */
export function updateLinkVisuals(
  linkGlow: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>,
  linkLine: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>,
  agents: Map<string, AgentState>,
) {
  const getTargetId = (d: SimLink) =>
    typeof d.target === "string" ? d.target : d.target.id;

  const isBlocking = (d: SimLink) => d.edgeType === "blocking";

  linkGlow.attr("stroke", (d) => {
    if (isBlocking(d)) return EDGE_COLORS.blocking;
    if (d.edgeType === "message") return UI.tool;
    const a = agents.get(getTargetId(d));
    return a ? AGENT_COLORS[a.agentType] : UI.text.secondary;
  });
  linkLine
    .attr("stroke", (d) => {
      if (isBlocking(d)) return EDGE_COLORS.blocking;
      if (d.edgeType === "message") return UI.tool;
      const a = agents.get(getTargetId(d));
      return a ? AGENT_COLORS[a.agentType] : UI.text.secondary;
    })
    .attr("stroke-width", (d) => isBlocking(d) ? 2.5 : d.edgeType === "message" ? 1.5 : 2)
    .attr("stroke-dasharray", (d) => {
      if (isBlocking(d)) return "6 3";
      if (d.edgeType === "message") return "4 3";
      const a = agents.get(getTargetId(d));
      const active = a?.status === "running" || a?.status === "idle";
      return active ? "8 4" : "none";
    })
    .attr("marker-end", (d) => isBlocking(d) ? "url(#arrowhead-blocking)" : null)
    .each(function (d) {
      const line = d3.select(this);
      line.selectAll("animate").remove();
      if (isBlocking(d)) {
        line.append("animate")
          .attr("attributeName", "stroke-opacity")
          .attr("values", "0.4;0.9;0.4")
          .attr("dur", "1.5s")
          .attr("repeatCount", "indefinite");
        line.append("animate")
          .attr("attributeName", "stroke-dashoffset")
          .attr("values", "18;0")
          .attr("dur", "1s")
          .attr("repeatCount", "indefinite");
      } else {
        const a = agents.get(getTargetId(d));
        const active = a?.status === "running" || a?.status === "idle";
        if (d.edgeType !== "message" && active) {
          line.append("animate")
            .attr("attributeName", "stroke-dashoffset")
            .attr("values", "24;0")
            .attr("dur", a?.status === "running" ? "0.8s" : "1.6s")
            .attr("repeatCount", "indefinite");
        }
      }
    });

  linkLine.attr("stroke-opacity", (d) => {
    if (isBlocking(d)) return 0.8;
    if (d.edgeType === "message") return 0.5;
    const a = agents.get(getTargetId(d));
    const finished = a?.status === "completed" || a?.status === "error";
    return finished ? 0.2 : 0.6;
  });

  linkGlow
    .attr("stroke-width", (d) => isBlocking(d) ? 8 : 6)
    .attr("stroke-opacity", (d) => {
      if (isBlocking(d)) return 0.2;
      if (d.edgeType === "message") return 0.05;
      const a = agents.get(getTargetId(d));
      const finished = a?.status === "completed" || a?.status === "error";
      return finished ? 0.03 : 0.1;
    });
}
