"use client";

import { useEffect, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useAgentStore } from "@/lib/store";
import { agentColor } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { useAgentGraphRefs } from "./refs";
import { useFitToView } from "./useFitToView";
import { useTopologyEffect } from "./useTopologyEffect";
import { useNodeVisualsEffect } from "./useNodeVisualsEffect";
import { useToolNodesEffect } from "./useToolNodesEffect";
import { useLifecycleEffectsLayer } from "./useLifecycleEffectsLayer";
import { useLayoutModeEffect } from "./useLayoutModeEffect";
import { useResizeEffect } from "./useResizeEffect";

export interface AgentGraphHandle {
  fitToView(): void;
  getNodesAndViewport(): {
    nodes: Array<{ x: number; y: number; color: string }>;
    viewport: { x: number; y: number; width: number; height: number };
  } | null;
}

export const AgentGraph = forwardRef<AgentGraphHandle>(function AgentGraph(_props, ref) {
  const refs = useAgentGraphRefs();

  const agents = useAgentStore((s) => s.agents);
  const edges = useAgentStore((s) => s.edges);
  const teams = useAgentStore((s) => s.teams);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const activity = useAgentStore((s) => s.activity);
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const heatmapEnabled = useAgentStore((s) => s.heatmapEnabled);
  const heatmapMetric = useAgentStore((s) => s.heatmapMetric);
  const graphLayout = useAgentStore((s) => s.graphLayout);
  const filteredAgents = useFilteredAgents();
  // Cheap integer that bumps only when topology actually changes (agents
  // join/leave, parent/team links move, message/blocking edges added or
  // removed). Replaces the old per-render `.map().sort().join("|")` over
  // filteredAgents+edges, which ran on every store update — including
  // pure-token events that don't affect graph shape.
  const topologyVersion = useAgentStore((s) => s.topologyVersion);

  const fitToView = useFitToView(refs);

  // Auto-fit whenever the topology changes. Wait briefly for the force
  // simulation to settle so we fit the final layout, not the spawn positions.
  // This is the SINGLE auto-fit path — the old inline 1500ms duplicate inside
  // the topology effect was deleted as part of the split.
  useEffect(() => {
    if (filteredAgents.length === 0) return;
    const timer = setTimeout(() => fitToView(), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyVersion, fitToView]);

  useTopologyEffect(refs, {
    filteredAgents, edges, agents, teams,
    selectedAgentId, selectedTeamId, topologyVersion, selectAgent,
  });
  useNodeVisualsEffect(refs, { agents, selectedAgentId, heatmapEnabled, heatmapMetric });
  useToolNodesEffect(refs, { agents });
  useLifecycleEffectsLayer(refs, { agents, activity });
  useLayoutModeEffect(refs, { graphLayout, topologyVersion });
  useResizeEffect(refs, fitToView);

  useImperativeHandle(ref, () => ({
    getNodesAndViewport() {
      const svg = refs.svgRef.current;
      if (!svg || !refs.zoomRef.current) return null;
      const transform = d3.zoomTransform(svg);
      const nodes = refs.nodesRef.current
        .filter((n) => n.x !== undefined && n.y !== undefined)
        .map((n) => ({
          x: n.x!,
          y: n.y!,
          color: agentColor(n.agent),
        }));
      return {
        nodes,
        viewport: {
          x: -transform.x / transform.k,
          y: -transform.y / transform.k,
          width: svg.clientWidth / transform.k,
          height: svg.clientHeight / transform.k,
        },
      };
    },
    fitToView: () => fitToView(),
  }));

  return (
    <div ref={refs.containerRef} className="flex-1 h-full" style={{ background: "var(--color-bg)" }}>
      <svg ref={refs.svgRef} style={{ display: "block" }} />
    </div>
  );
});
