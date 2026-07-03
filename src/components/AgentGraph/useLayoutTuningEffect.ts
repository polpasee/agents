import { useEffect, useRef } from "react";
import type { AgentState, GraphLayout, LayoutTuning } from "@/lib/types";
import type { AgentGraphRefs } from "./refs";
import { applyTunableForces } from "./useTopologyEffect";

interface Options {
  layoutTuning: LayoutTuning;
  filteredAgents: AgentState[];
  agents: Map<string, AgentState>;
  graphLayout: GraphLayout;
}

/**
 * Effect 1b: live in-place retune when a Layout Tuning slider changes.
 *
 * Re-applies the tunable force chain onto the EXISTING simulation via
 * `applyTunableForces` (shared with the topology-rebuild effect in
 * useTopologyEffect) instead of rebuilding nodes/links or touching the SVG.
 * That keeps tool nodes/links (owned by useToolNodesEffect, keyed on
 * `agents` — not `layoutTuning`) and pinned static-layout (tree/radial/
 * hierarchical) fx/fy positions untouched by a slider drag.
 *
 * Skips its first (mount) run so it doesn't duplicate the build effect's
 * initial force setup.
 *
 * Reads:  simulationRef, containerRef, linksRef, layoutTuning, filteredAgents,
 *         agents, graphLayout
 * Writes: simulation forces (in place); restarts the simulation only in
 *         force mode — static layouts stay pinned until the user switches
 *         back (useLayoutModeEffect re-applies then).
 */
export function useLayoutTuningEffect(refs: AgentGraphRefs, opts: Options) {
  const { layoutTuning, filteredAgents, agents, graphLayout } = opts;
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }

    const sim = refs.simulationRef.current;
    if (!sim) return;

    const container = refs.containerRef.current;
    const width = container?.clientWidth ?? 0;
    const height = container?.clientHeight ?? 0;
    const agentIds = new Set(filteredAgents.map((a) => a.id));
    const links = refs.linksRef.current;

    applyTunableForces(sim, {
      agents,
      agentIds,
      links,
      width,
      height,
      layoutTuning,
    });

    if (graphLayout === "force") {
      sim.alpha(0.3).restart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, layoutTuning]);
}
