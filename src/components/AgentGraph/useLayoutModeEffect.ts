import { useEffect } from "react";
import { select } from "d3-selection";
import { bezierPath } from "@/lib/d3";
import type { SimNode, SimLink } from "@/lib/d3";
import { applyTreeLayout, applyRadialLayout, applyHierarchicalLayout } from "@/lib/d3/layouts";
import type { GraphLayout } from "@/lib/types";
import type { AgentGraphRefs } from "./refs";

interface Options {
  graphLayout: GraphLayout;
  topologyVersion: number;
}

/**
 * Switches between force layout and the static tree/radial/hierarchical
 * layouts. Re-runs whenever layout mode or topology changes.
 *
 * Reads:  simulationRef, containerRef, svgRef, nodesRef, linksRef, graphLayout
 * Writes: node fx/fy + g.node transforms + link path d attributes
 */
export function useLayoutModeEffect(refs: AgentGraphRefs, opts: Options) {
  const { graphLayout, topologyVersion } = opts;

  useEffect(() => {
    const simulation = refs.simulationRef.current;
    const container = refs.containerRef.current;
    const svg = refs.svgRef.current;
    const nodes = refs.nodesRef.current;
    const links = refs.linksRef.current;
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
      const d3svg = select(svg);
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
  }, [refs, graphLayout, topologyVersion]);
}
