import { useCallback } from "react";
import * as d3 from "d3";
import { GRAPH } from "@/lib/config";
import type { AgentGraphRefs } from "./refs";

/**
 * Single fit-to-view implementation. Consolidates the original `useCallback`
 * implementation and the duplicate inline block that lived in the
 * `setTimeout(..., 1500)` post-simulation auto-fit.
 *
 * Reads:  svgRef, containerRef, zoomRef, nodesRef
 * Writes: nothing (transitions zoom transform on the SVG)
 */
export function useFitToView(refs: AgentGraphRefs) {
  return useCallback((duration = 500) => {
    const svg = refs.svgRef.current;
    const container = refs.containerRef.current;
    const zoom = refs.zoomRef.current;
    const nodes = refs.nodesRef.current;
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
  }, [refs]);
}
