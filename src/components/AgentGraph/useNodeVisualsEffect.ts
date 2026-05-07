import { useEffect } from "react";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import { UI, agentColor } from "@/lib/colors";
import { GRAPH } from "@/lib/config";
import {
  renderNodeVisuals,
  updateLinkVisuals,
  bezierPath,
  renderHeatmapNode,
  renderHeatmapLegend,
  computeMetricValue,
  precomputeHeatmapNorms,
  createHeatmapScale,
} from "@/lib/d3";
import type { SimNode, SimLink } from "@/lib/d3";
import type { AgentState, HeatmapMetric } from "@/lib/types";
import type { AgentGraphRefs } from "./refs";

interface Options {
  agents: Map<string, AgentState>;
  selectedAgentId: string | null;
  heatmapEnabled: boolean;
  heatmapMetric: HeatmapMetric;
}

/**
 * Effect 2b: in-place node visual refresh + heatmap legend + link recolor +
 * particle animation rebuild on agent state changes.
 *
 * Reads:  svgRef, agents/selectedAgentId/heatmap props
 * Writes: SVG node/link/particle DOM in place (no full wipe)
 */
export function useNodeVisualsEffect(refs: AgentGraphRefs, opts: Options) {
  const { agents, selectedAgentId, heatmapEnabled, heatmapMetric } = opts;

  useEffect(() => {
    const svg = refs.svgRef.current;
    if (!svg) return;

    const d3svg = select(svg);
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
      const prev = select(this).attr("data-hash");
      d.agent = latest;
      if (prev === hash) return; // skip re-render — nothing visual changed
      const g = select(this);
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
      const svgSel = d3svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>;
      renderHeatmapLegend(svgSel, heatmapMetric, 16, svg.clientHeight - 60);
    }

    // Update link colors / dash patterns
    const linkGroup = select(svg).select<SVGGElement>("g.links");
    if (!linkGroup.empty()) {
      updateLinkVisuals(
        linkGroup.selectAll<SVGPathElement, SimLink>("path.glow"),
        linkGroup.selectAll<SVGPathElement, SimLink>("path.main"),
        agents,
      );
    }
    // Animate particles on active links — only rebuild when active link set changes
    const particleGroup = select(svg).select<SVGGElement>("g.particles");
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
    // UI is unused here but referenced in the original file via the import; the
    // node-visual helpers in `@/lib/d3` consume it internally.
    void UI;
  }, [refs, agents, selectedAgentId, heatmapEnabled, heatmapMetric]);
}
