import { useEffect } from "react";
import { select } from "d3-selection";
import type { AgentGraphRefs } from "./refs";

/**
 * Resize observer: keeps the SVG sized to its container and re-fits the view
 * after each resize.
 *
 * Reads:  containerRef, svgRef
 * Writes: SVG width/height + zoom transform via fitToView
 */
export function useResizeEffect(refs: AgentGraphRefs, fitToView: (duration?: number) => void) {
  useEffect(() => {
    const container = refs.containerRef.current;
    const svg = refs.svgRef.current;
    if (!container || !svg) return;

    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      select(svg).attr("width", width).attr("height", height);
      fitToView(250);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [refs, fitToView]);
}
