import { useEffect } from "react";
import { select } from "d3-selection";
import { zoom } from "d3-zoom";
import {
  forceSimulation,
  forceLink,
  forceX,
  forceY,
  forceCollide,
} from "d3-force";
import { EDGE_COLORS, UI, WORKFLOW_COLOR, agentColor } from "@/lib/colors";
import { GRAPH, getNodeRadius } from "@/lib/config";
import {
  renderNodeVisuals,
  updateLinkVisuals,
  linkPath,
  clusterHullPath,
  clusterLabelAnchor,
  agentDepth,
  depthFactor,
  rootAgentId,
  forceGroupedManyBody,
} from "@/lib/d3";
import type { SimNode, SimLink } from "@/lib/d3";
import type {
  AgentState,
  EdgeState,
  TeamState,
  WorkflowRunState,
} from "@/lib/types";
import type { AgentGraphRefs } from "./refs";
import { simulationDrag } from "./simulationDrag";
import { buildWorkflowLabelMap } from "@/lib/workflowLabels";

interface Options {
  filteredAgents: AgentState[];
  edges: EdgeState[];
  agents: Map<string, AgentState>;
  teams: Map<string, TeamState>;
  workflows: Map<string, WorkflowRunState>;
  selectedAgentId: string | null;
  selectedTeamId: string | null;
  selectedWorkflowId: string | null;
  topologyVersion: number;
  selectAgent: (id: string | null) => void;
}

/**
 * Effect 1: full simulation rebuild on topology change.
 *
 * Reads:  filteredAgents, edges, agents, teams, workflows, selectedAgentId,
 *         selectedTeamId, selectedWorkflowId (props), nodesRef (for prev positions)
 * Writes: svgRef DOM, simulationRef, nodesRef, linksRef, zoomRef
 *
 * The tick handler updates link/node/team-cluster/workflow-hull geometry only.
 * It does NOT render lifecycle effects — those run on a RAF loop in
 * `useLifecycleEffectsLayer` (P-H1 fix).
 */
export function useTopologyEffect(refs: AgentGraphRefs, opts: Options) {
  const {
    filteredAgents,
    edges,
    agents,
    teams,
    workflows,
    selectedAgentId,
    selectedTeamId,
    selectedWorkflowId,
    selectAgent,
    topologyVersion,
  } = opts;

  useEffect(() => {
    const svg = refs.svgRef.current;
    const container = refs.containerRef.current;
    if (!svg || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const d3svg = select(svg).attr("width", width).attr("height", height);
    d3svg.selectAll("*").remove();

    const agentIds = new Set(filteredAgents.map((a) => a.id));

    // Carry forward positions from previous simulation so layout stays stable
    const prevPositions = new Map<string, { x: number; y: number }>();
    for (const n of refs.nodesRef.current) {
      if (n.x !== undefined && n.y !== undefined) {
        prevPositions.set(n.id, { x: n.x, y: n.y });
      }
    }

    const nodes: SimNode[] = filteredAgents.map((a) => {
      const prev = prevPositions.get(a.id);
      return {
        id: a.id,
        agent: a,
        depth: agentDepth(a.id, agents),
        ...(prev ? { x: prev.x, y: prev.y } : {}),
      };
    });

    // Workflow agents carry a human label (e.g. "find:A-line-scan"); surface it
    // as the node's sub-label. Skip the workflow-scan fallback where label===agentId.
    const agentIdToLabel = buildWorkflowLabelMap(workflows);
    for (const node of nodes) {
      const wfLabel = agentIdToLabel.get(node.id);
      if (wfLabel) node.workflowLabel = wfLabel;
    }

    // Parent-child links
    const parentLinks: SimLink[] = filteredAgents
      .filter((a) => a.parentId && agentIds.has(a.parentId))
      .map((a) => ({
        source: a.parentId!,
        target: a.id,
        edgeType: "parent" as const,
      }));
    // Peer-to-peer message links
    const messageLinks: SimLink[] = edges
      .filter(
        (e) =>
          e.edgeType === "message" &&
          agentIds.has(e.source) &&
          agentIds.has(e.target),
      )
      .map((e) => ({
        source: e.source,
        target: e.target,
        edgeType: "message" as const,
      }));
    // Blocking dependency links
    const blockingLinks: SimLink[] = edges
      .filter(
        (e) =>
          e.edgeType === "blocking" &&
          agentIds.has(e.source) &&
          agentIds.has(e.target),
      )
      .map((e) => ({
        source: e.source,
        target: e.target,
        edgeType: "blocking" as const,
      }));
    const links: SimLink[] = [
      ...parentLinks,
      ...messageLinks,
      ...blockingLinks,
    ];

    refs.nodesRef.current = nodes;
    refs.linksRef.current = links;

    if (nodes.length === 0) {
      d3svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", UI.text.empty)
        .attr("font-size", 14)
        .text("No agents connected");
      return;
    }

    // Defs for glow filters
    const defs = d3svg.append("defs");
    const glowFilter = defs.append("filter").attr("id", "glow");
    glowFilter
      .append("feGaussianBlur")
      .attr("stdDeviation", 3)
      .attr("result", "blur");
    glowFilter
      .append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Arrowhead marker for blocking edges
    defs
      .append("marker")
      .attr("id", "arrowhead-blocking")
      .attr("viewBox", "0 0 10 6")
      .attr("refX", 38)
      .attr("refY", 3)
      .attr("markerWidth", 10)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,0 L10,3 L0,6 Z")
      .attr("fill", EDGE_COLORS.blocking)
      .attr("opacity", 0.8);

    // Canvas group for zoom/pan
    const canvas = d3svg.append("g").attr("class", "canvas");
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH.zoomExtent)
      .on("zoom", (event) => canvas.attr("transform", event.transform));
    d3svg.call(zoomBehavior);
    refs.zoomRef.current = zoomBehavior;

    // Click on empty graph area deselects the current agent. Node clicks
    // stopPropagation (below) so they don't accidentally trigger this.
    d3svg.on("click", () => selectAgent(null));

    // Background hex grid pattern
    const gridSize = 30;
    const gridPattern = defs
      .append("pattern")
      .attr("id", "hexGrid")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", gridSize * Math.sqrt(3))
      .attr("height", gridSize * 3)
      .attr("patternTransform", "rotate(0)");

    // Draw one hex cell in the pattern
    const hx = (gridSize * Math.sqrt(3)) / 2;
    const hy = gridSize;
    gridPattern
      .append("path")
      .attr(
        "d",
        `M${hx},0 L${hx * 2},${hy * 0.5} L${hx * 2},${hy * 1.5} L${hx},${hy * 2} L0,${hy * 1.5} L0,${hy * 0.5}Z`,
      )
      .attr("fill", "none")
      .attr("stroke", "#141e30")
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.3);

    // Apply grid as background rect behind everything
    canvas
      .append("rect")
      .attr("x", -10000)
      .attr("y", -10000)
      .attr("width", 20000)
      .attr("height", 20000)
      .attr("fill", "url(#hexGrid)");

    // Team cluster backgrounds (rendered first so they appear behind everything)
    const teamClusterGroup = canvas.append("g").attr("class", "team-clusters");

    // Workflow cluster backgrounds (in front of team clusters, behind nodes)
    const workflowClusterGroup = canvas
      .append("g")
      .attr("class", "workflow-clusters");

    // Tool links rendered behind agent links for visual hierarchy
    canvas.append("g").attr("class", "tool-links");

    // Link groups (glow + main path) — using bezier paths
    const linkGroup = canvas.append("g").attr("class", "links");
    linkGroup
      .selectAll<SVGPathElement, SimLink>("path.glow")
      .data(links)
      .join("path")
      .attr("class", (d) => `glow ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", 6)
      .attr("stroke-opacity", 0.1);
    linkGroup
      .selectAll<SVGPathElement, SimLink>("path.main")
      .data(links)
      .join("path")
      .attr("class", (d) => `main ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", (d) => (d.edgeType === "message" ? 2 : 2.5))
      .attr("stroke-opacity", 0.7);

    // Apply initial link colors
    updateLinkVisuals(
      linkGroup.selectAll<SVGPathElement, SimLink>("path.glow"),
      linkGroup.selectAll<SVGPathElement, SimLink>("path.main"),
      agents,
    );

    // Particle group for link flow animation
    canvas.append("g").attr("class", "particles");

    // Effects group for lifecycle animations (drained by RAF in useLifecycleEffectsLayer)
    canvas.append("g").attr("class", "effects");

    // Tool nodes rendered behind agent nodes
    canvas.append("g").attr("class", "tool-nodes");

    // Node groups
    const nodeGroup = canvas.append("g").attr("class", "nodes");
    const nodeSelection = nodeGroup
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        selectAgent(d.agent.id);
      });

    // Render initial node visuals
    nodeSelection.each(function (d) {
      renderNodeVisuals(
        select(this),
        d.agent,
        selectedAgentId,
        d.depth,
        d.workflowLabel,
      );
    });

    // Force simulation — use low alpha when restoring positions
    const linkGlow = linkGroup.selectAll<SVGPathElement, SimLink>("path.glow");
    const linkLine = linkGroup.selectAll<SVGPathElement, SimLink>("path.main");

    // Build team-to-nodes lookup for cluster rendering
    const teamNodeMap = new Map<string, SimNode[]>();
    for (const node of nodes) {
      if (node.agent.teamId) {
        const list = teamNodeMap.get(node.agent.teamId) || [];
        list.push(node);
        teamNodeMap.set(node.agent.teamId, list);
      }
    }

    // Precompute the team entries array once per topology rebuild.
    // The tick handler runs at ~60 Hz; filtering teamNodeMap.entries() every tick
    // is wasteful because teamNodeMap doesn't change between topology rebuilds.
    // Node positions (x/y) are checked inside teamMerged.each(), so we only
    // need to filter here for teams that have at least 2 *members* (position
    // readiness is checked per-frame inside the hull calculation).
    const teamEntries = Array.from(teamNodeMap.entries()).filter(
      ([, ns]) => ns.length >= 2,
    );

    // Build workflow-to-nodes lookup for cluster rendering.
    // Precomputed once per topology rebuild (not per ~60Hz tick). Filtered to
    // runs with ≥2 present member nodes; the join is best-effort against
    // currently-live SimNodes — a run may reference agents not yet/no longer
    // live, and the hull appears only once ≥2 members are present.
    // Each run's agents are joined to SimNodes by agentId.
    const agentIdToRunId = new Map<string, string>();
    const agentIdToPhaseTitle = new Map<string, string | undefined>();
    for (const run of workflows.values()) {
      for (const ref of run.agents) {
        agentIdToRunId.set(ref.agentId, run.runId);
        agentIdToPhaseTitle.set(ref.agentId, ref.phaseTitle);
      }
    }

    const workflowNodeMap = new Map<string, SimNode[]>();
    for (const node of nodes) {
      const runId = agentIdToRunId.get(node.id);
      if (runId) {
        const list = workflowNodeMap.get(runId) ?? [];
        list.push(node);
        workflowNodeMap.set(runId, list);
      }
    }
    const workflowEntries = Array.from(workflowNodeMap.entries()).filter(
      ([, ns]) => ns.length >= 2,
    );

    // Precompute per-run phase groupings once per topology rebuild.
    // `agentIdToPhaseTitle` and `runNodes` are both stable between ticks
    // (neither changes until the next topology rebuild), so rebuilding this
    // Map<runId, Map<phaseTitle, SimNode[]>> inside the ~60Hz tick callback
    // is pure redundant work. Node positions (x/y) are NOT used here — only
    // node.id is looked up against agentIdToPhaseTitle. The per-tick code
    // that reads positions (avgX/avgY centroid calculation) remains in the tick.
    const nodesByPhasePerRun = new Map<string, Map<string, SimNode[]>>();
    for (const [runId, runNodes] of workflowEntries) {
      const nodesByPhase = new Map<string, SimNode[]>();
      for (const node of runNodes) {
        const phaseTitle = agentIdToPhaseTitle.get(node.id);
        if (!phaseTitle) continue;
        const list = nodesByPhase.get(phaseTitle) ?? [];
        list.push(node);
        nodesByPhase.set(phaseTitle, list);
      }
      nodesByPhasePerRun.set(runId, nodesByPhase);
    }

    // Charge is scoped per family: a main agent and the sub-agents it spawned
    // (same root ancestor) repel only each other, so each family fans out
    // radially without disturbing unrelated families. Main agents additionally
    // share a "roots" bucket so the top layer still spreads itself apart. Tool
    // nodes join their owning agent's family. THIS predicate is the definition
    // of "who affects whom" — widen/narrow the buckets to change the scoping.
    //
    // Deliberate trade-off: sub-agents of DIFFERENT families share no bucket,
    // so they exert no long-range repulsion on each other — only forceCollide
    // resolves any physical overlap. This is intended (family isolation); do
    // not add cross-family charge here without revisiting that goal.
    const chargeBucketsOf = (node: SimNode): string[] => {
      const ownerId = node.toolCall?.parentAgentId ?? node.id;
      const family = `fam:${rootAgentId(ownerId, agents)}`;
      return node.toolCall || node.agent.parentId ? [family] : ["roots", family];
    };

    const simulation = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((d) => {
            if (d.edgeType === "tool") return GRAPH.toolLinkDistance;
            // Parent links shrink with the child's nesting depth (depth 1 is a
            // no-op). Team members render full-size, so their links don't scale.
            if (d.edgeType === "parent") {
              const target = d.target as SimNode;
              return (
                GRAPH.subAgentLinkDistance *
                (target.agent.teamId ? 1 : depthFactor(target.depth))
              );
            }
            return GRAPH.linkDistance;
          })
          .strength((d) => {
            if (d.edgeType === "tool") return GRAPH.linkStrengthTool;
            if (d.edgeType === "parent") return GRAPH.linkStrengthParent;
            return GRAPH.linkStrengthPeer;
          }),
      )
      .force(
        "charge",
        forceGroupedManyBody<SimNode>(chargeBucketsOf)
          .distanceMax(GRAPH.chargeDistanceMax)
          .strength((d) => {
            if (d.toolCall) return GRAPH.chargeStrengthTool;
            // Team members render full-size, so their charge doesn't scale.
            if (d.agent.parentId)
              return (
                GRAPH.chargeStrengthSubAgent *
                (d.agent.teamId ? 1 : depthFactor(d.depth))
              );
            return GRAPH.chargeStrengthMain;
          }),
      )
      .force(
        "x",
        forceX<SimNode>(width / 2).strength((d) =>
          d.toolCall ? 0 : GRAPH.centerStrength,
        ),
      )
      .force(
        "y",
        forceY<SimNode>(height / 2).strength((d) =>
          d.toolCall ? 0 : GRAPH.centerStrength,
        ),
      )
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) =>
          d.toolCall
            ? GRAPH.toolNodeRadius + 4
            : getNodeRadius(d.agent, depthFactor(d.depth)) + 4,
        ),
      )
      .alpha(prevPositions.size > 0 ? GRAPH.newNodeAlpha : 1)
      .on("tick", () => {
        // Glow/main pairs share datum objects (same `links` array), so compute
        // each path once on the glow pass and reuse the cached value for main.
        linkGlow.attr("d", (d) => (d.pathD = linkPath(d)));
        linkLine.attr("d", (d) => d.pathD ?? "");
        nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y})`);

        // Update tool node positions
        canvas
          .select<SVGGElement>("g.tool-nodes")
          .selectAll<SVGGElement, SimNode>("g.tool-node")
          .attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);

        // Update tool link endpoints (source/target resolved to objects by forceLink)
        canvas
          .select<SVGGElement>("g.tool-links")
          .selectAll<SVGLineElement, SimLink>("line")
          .each(function (d) {
            const s = d.source as SimNode;
            const t = d.target as SimNode;
            if (s?.x == null || t?.x == null) return;
            const dx = t.x! - s.x!;
            const dy = t.y! - s.y!;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            select(this)
              .attr("x1", s.x!)
              .attr("y1", s.y!)
              .attr("x2", t.x! - ux * GRAPH.toolNodeRadius)
              .attr("y2", t.y! - uy * GRAPH.toolNodeRadius);
          });

        // Update team cluster hulls — join by team id and update in place
        // to avoid a full remove/re-append on every simulation tick.
        // teamEntries is precomputed above (stable per topology rebuild).
        const teamGroups = teamClusterGroup
          .selectAll<SVGGElement, [string, SimNode[]]>("g.team")
          .data(teamEntries, (d) => d[0]);
        teamGroups.exit().remove();
        const teamEnter = teamGroups.enter().append("g").attr("class", "team");
        teamEnter.append("path").attr("class", "cluster-shape");
        teamEnter
          .append("text")
          .attr("class", "cluster-label")
          .attr("text-anchor", "middle")
          .attr("font-family", "monospace")
          .attr("font-size", 10)
          .attr("font-weight", "bold");
        const teamMerged = teamEnter.merge(teamGroups);

        teamMerged.each(function ([teamId, teamNodes]) {
          const g = select(this);
          const points = teamNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!] as [number, number]);
          const team = teams.get(teamId);
          const isSelectedTeam = teamId === selectedTeamId;
          const leader = teamNodes.find(
            (n) => n.agent.agentType === "team-lead",
          );
          const clusterColor = leader ? agentColor(leader.agent) : UI.primary;

          g.select<SVGPathElement>("path.cluster-shape")
            .attr("d", clusterHullPath(points))
            .attr("fill", `${clusterColor}08`)
            .attr("stroke", clusterColor)
            .attr("stroke-width", isSelectedTeam ? 1.5 : 1)
            .attr("stroke-opacity", isSelectedTeam ? 0.5 : 0.2)
            .attr("stroke-dasharray", "6 3")
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.cluster-label");
          if (team) {
            const anchor = clusterLabelAnchor(points);
            label
              .attr("x", anchor.x)
              .attr("y", anchor.y)
              .attr("fill", clusterColor)
              .attr("opacity", isSelectedTeam ? 0.8 : 0.4)
              .text(team.name);
          } else {
            label.text("");
          }
        });

        // Update workflow cluster hulls
        const workflowGroups = workflowClusterGroup
          .selectAll<SVGGElement, [string, SimNode[]]>("g.workflow")
          .data(workflowEntries, (d) => d[0]);
        workflowGroups.exit().remove();
        const workflowEnter = workflowGroups
          .enter()
          .append("g")
          .attr("class", "workflow");
        workflowEnter.append("path").attr("class", "wf-cluster-shape");
        workflowEnter
          .append("text")
          .attr("class", "wf-cluster-label")
          .attr("text-anchor", "middle")
          .attr("font-family", "monospace")
          .attr("font-size", 10)
          .attr("font-weight", "bold");
        const workflowMerged = workflowEnter.merge(workflowGroups);

        workflowMerged.each(function ([runId, runNodes]) {
          const g = select(this);
          const points = runNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!] as [number, number]);
          const run = workflows.get(runId);
          const isSelectedWorkflow = runId === selectedWorkflowId;
          const wfColor = WORKFLOW_COLOR;

          g.select<SVGPathElement>("path.wf-cluster-shape")
            .attr("d", clusterHullPath(points))
            .attr("fill", `${wfColor}08`)
            .attr("stroke", wfColor)
            .attr("stroke-width", isSelectedWorkflow ? 2 : 1)
            .attr("stroke-opacity", isSelectedWorkflow ? 0.6 : 0.25)
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.wf-cluster-label");
          if (run) {
            const anchor = clusterLabelAnchor(points);
            label
              .attr("x", anchor.x)
              .attr("y", anchor.y)
              .attr("fill", wfColor)
              .attr("opacity", isSelectedWorkflow ? 0.9 : 0.5)
              .text(`⚙ ${run.name}`);
          } else {
            label.text("");
          }
        });

        // Phase centroid labels inside workflow clusters
        workflowMerged.each(function ([runId]) {
          const g = select(this);
          const run = workflows.get(runId);
          if (!run || run.phases.length === 0) return;

          // Use the precomputed phase grouping (hoisted above the tick).
          // Only the position-dependent centroid calculation stays here.
          const nodesByPhase = nodesByPhasePerRun.get(runId);
          if (!nodesByPhase) return;

          // Join phase labels
          const phaseData = Array.from(nodesByPhase.entries()).filter(
            ([, ns]) => ns.every((n) => n.x != null && n.y != null),
          );

          const phaseLabels = g
            .selectAll<SVGTextElement, [string, SimNode[]]>("text.phase-label")
            .data(phaseData, (d) => d[0]);
          phaseLabels.exit().remove();
          phaseLabels
            .enter()
            .append("text")
            .attr("class", "phase-label")
            .attr("text-anchor", "middle")
            .attr("font-family", "monospace")
            .attr("font-size", 8)
            .merge(phaseLabels)
            .each(function ([phaseTitle, phaseNodes]) {
              const avgX =
                phaseNodes.reduce((s, n) => s + n.x!, 0) / phaseNodes.length;
              const avgY =
                phaseNodes.reduce((s, n) => s + n.y!, 0) / phaseNodes.length;
              select(this)
                .attr("x", avgX)
                .attr("y", avgY - 18)
                .attr("fill", WORKFLOW_COLOR)
                .attr("opacity", 0.5)
                .text(phaseTitle);
            });
        });
      });

    // Drag behavior (shared with tool nodes)
    nodeSelection.call(simulationDrag(simulation));

    refs.simulationRef.current = simulation;
    return () => {
      simulation.stop();
    };
    // Intentional: closure over selectedAgentId/selectedTeamId/selectedWorkflowId/
    // teams/workflows/agents is fine because Effect 2b handles agents/selectedAgentId;
    // the tick handler re-reads selectedTeamId/teams/selectedWorkflowId/workflows
    // from closure on every simulation tick.
    // This effect also derives per-node depth from `agents` (agentDepth at
    // node-build time). That stays correct only because every parentId
    // mutation sets topologyDirty — bumping topologyVersion and rebuilding
    // here; Effect 2b refreshes d.agent in place but never d.depth.
    // Rebuilding only on topologyVersion is the entire point of PR #6.
    // upsertWorkflow/removeWorkflow and the team/agent equivalents all bump
    // topologyVersion, so workflow hull changes correctly ride the existing rebuild.
    //
    // We DO include filteredAgents.length: the session/type filter is a UI
    // concern that doesn't bump topologyVersion (which tracks graph-shape
    // changes — agent register/remove, parent/team/workflow moves, edge add/remove),
    // so without this dep a filter flip from "no matches" to "1 match" leaves
    // the graph stuck on the empty-state message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyVersion, filteredAgents.length, selectAgent]);
}
