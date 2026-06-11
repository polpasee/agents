import { drag } from "d3-drag";
import type { Simulation } from "d3-force";
import type { SimNode, SimLink } from "@/lib/d3";

/**
 * Shared drag behavior for agent and tool nodes: heat the simulation on
 * drag start, pin fx/fy while dragging, release both (and cool down) on end.
 */
export function simulationDrag(simulation: Simulation<SimNode, SimLink>) {
  return drag<SVGGElement, SimNode>()
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
    });
}
