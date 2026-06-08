import { useEffect } from "react";
import { select } from "d3-selection";
import { zoom } from "d3-zoom";
import { drag } from "d3-drag";
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from "d3-force";
import { polygonHull, polygonCentroid } from "d3-polygon";
import { EDGE_COLORS, UI, WORKFLOW_COLOR, agentColor } from "@/lib/colors";
import { GRAPH, getNodeRadius } from "@/lib/config";
import { renderNodeVisuals, updateLinkVisuals, bezierPath } from "@/lib/d3";
import type { SimNode, SimLink } from "@/lib/d3";
import type { AgentState, EdgeState, TeamState, WorkflowRunState } from "@/lib/types";
import type { AgentGraphRefs } from "./refs";

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
  const { filteredAgents, edges, agents, teams, workflows, selectedAgentId, selectedTeamId, selectedWorkflowId, selectAgent, topologyVersion } = opts;

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
        ...(prev ? { x: prev.x, y: prev.y } : {}),
      };
    });
    // Parent-child links
    const parentLinks: SimLink[] = filteredAgents
      .filter((a) => a.parentId && agentIds.has(a.parentId))
      .map((a) => ({ source: a.parentId!, target: a.id, edgeType: "parent" as const }));
    // Peer-to-peer message links
    const messageLinks: SimLink[] = edges
      .filter((e) => e.edgeType === "message" && agentIds.has(e.source) && agentIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, edgeType: "message" as const }));
    // Blocking dependency links
    const blockingLinks: SimLink[] = edges
      .filter((e) => e.edgeType === "blocking" && agentIds.has(e.source) && agentIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, edgeType: "blocking" as const }));
    const links: SimLink[] = [...parentLinks, ...messageLinks, ...blockingLinks];

    refs.nodesRef.current = nodes;
    refs.linksRef.current = links;

    if (nodes.length === 0) {
      d3svg.append("text")
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
    glowFilter.append("feGaussianBlur").attr("stdDeviation", 3).attr("result", "blur");
    glowFilter.append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", (d) => d);

    // Arrowhead marker for blocking edges
    defs.append("marker")
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
    const gridPattern = defs.append("pattern")
      .attr("id", "hexGrid")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", gridSize * Math.sqrt(3))
      .attr("height", gridSize * 3)
      .attr("patternTransform", "rotate(0)");

    // Draw one hex cell in the pattern
    const hx = gridSize * Math.sqrt(3) / 2;
    const hy = gridSize;
    gridPattern.append("path")
      .attr("d", `M${hx},0 L${hx*2},${hy*0.5} L${hx*2},${hy*1.5} L${hx},${hy*2} L0,${hy*1.5} L0,${hy*0.5}Z`)
      .attr("fill", "none")
      .attr("stroke", "#141e30")
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.3);

    // Apply grid as background rect behind everything
    canvas.append("rect")
      .attr("x", -10000).attr("y", -10000)
      .attr("width", 20000).attr("height", 20000)
      .attr("fill", "url(#hexGrid)");

    // Team cluster backgrounds (rendered first so they appear behind everything)
    const teamClusterGroup = canvas.append("g").attr("class", "team-clusters");

    // Workflow cluster backgrounds (behind team clusters and nodes)
    const workflowClusterGroup = canvas.append("g").attr("class", "workflow-clusters");

    // Tool links rendered behind agent links for visual hierarchy
    canvas.append("g").attr("class", "tool-links");

    // Link groups (glow + main path) — using bezier paths
    const linkGroup = canvas.append("g").attr("class", "links");
    linkGroup.selectAll<SVGPathElement, SimLink>("path.glow")
      .data(links).join("path").attr("class", (d) => `glow ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", 6).attr("stroke-opacity", 0.1);
    linkGroup.selectAll<SVGPathElement, SimLink>("path.main")
      .data(links).join("path").attr("class", (d) => `main ${d.edgeType || "parent"}`)
      .attr("fill", "none")
      .attr("stroke-width", (d) => d.edgeType === "message" ? 2 : 2.5)
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
    const nodeSelection = nodeGroup.selectAll<SVGGElement, SimNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .attr("cursor", "pointer")
      .on("click", (event, d) => { event.stopPropagation(); selectAgent(d.agent.id); });

    // Render initial node visuals
    nodeSelection.each(function (d) {
      renderNodeVisuals(select(this), d.agent, selectedAgentId);
    });

    // Drag behavior
    nodeSelection.call(
      drag<SVGGElement, SimNode>()
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
        })
    );

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

    const simulation = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => {
        if (d.edgeType === "tool") return GRAPH.toolLinkDistance;
        if (d.edgeType === "parent") return GRAPH.subAgentLinkDistance;
        return GRAPH.linkDistance;
      }))
      .force("charge", forceManyBody<SimNode>()
        .distanceMax(GRAPH.chargeDistanceMax)
        .strength((d) => {
          if (d.toolCall) return GRAPH.chargeStrengthTool;
          if (d.agent.parentId) return GRAPH.chargeStrengthSubAgent;
          return GRAPH.chargeStrengthMain;
        }))
      .force("x", forceX<SimNode>(width / 2).strength((d) => d.toolCall ? 0 : GRAPH.centerStrength))
      .force("y", forceY<SimNode>(height / 2).strength((d) => d.toolCall ? 0 : GRAPH.centerStrength))
      .force("collide", forceCollide<SimNode>().radius((d) =>
        d.toolCall ? GRAPH.toolNodeRadius + 4 : getNodeRadius(d.agent) + 4,
      ))
      .alpha(prevPositions.size > 0 ? GRAPH.newNodeAlpha : 1)
      .on("tick", () => {
        linkGlow.attr("d", (d) => bezierPath(
          (d.source as SimNode).x!, (d.source as SimNode).y!,
          (d.target as SimNode).x!, (d.target as SimNode).y!
        ));
        linkLine.attr("d", (d) => bezierPath(
          (d.source as SimNode).x!, (d.source as SimNode).y!,
          (d.target as SimNode).x!, (d.target as SimNode).y!
        ));
        nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y})`);

        // Update tool node positions
        canvas.select<SVGGElement>("g.tool-nodes")
          .selectAll<SVGGElement, SimNode>("g.tool-node")
          .attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);

        // Update tool link endpoints (source/target resolved to objects by forceLink)
        canvas.select<SVGGElement>("g.tool-links")
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
              .attr("x1", s.x!).attr("y1", s.y!)
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
        teamEnter.append("text").attr("class", "cluster-label")
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
          const leader = teamNodes.find((n) => n.agent.agentType === "team-lead");
          const clusterColor = leader ? agentColor(leader.agent) : UI.primary;

          let d = "";
          if (points.length === 2) {
            const cx = (points[0][0] + points[1][0]) / 2;
            const cy = (points[0][1] + points[1][1]) / 2;
            const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
            const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
            // Ellipse as SVG path
            d = `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`;
          } else {
            const hull = polygonHull(points);
            if (hull) {
              const centroid = polygonCentroid(hull);
              const expanded = hull.map(([x, y]) => {
                const dx = x - centroid[0];
                const dy = y - centroid[1];
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const pad = GRAPH.collideRadius;
                return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
              });
              d = `M${expanded.map((p) => p.join(",")).join("L")}Z`;
            }
          }

          g.select<SVGPathElement>("path.cluster-shape")
            .attr("d", d)
            .attr("fill", `${clusterColor}08`)
            .attr("stroke", clusterColor)
            .attr("stroke-width", isSelectedTeam ? 1.5 : 1)
            .attr("stroke-opacity", isSelectedTeam ? 0.5 : 0.2)
            .attr("stroke-dasharray", "6 3")
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.cluster-label");
          if (team) {
            // Avoid Math.min(...spread) — fold to stay stack-safe with
            // arbitrarily many cluster points.
            let avgY = Infinity;
            for (const p of points) if (p[1] < avgY) avgY = p[1];
            if (avgY === Infinity) avgY = 0;
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            label
              .attr("x", avgX)
              .attr("y", avgY - GRAPH.collideRadius - 8)
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
        const workflowEnter = workflowGroups.enter().append("g").attr("class", "workflow");
        workflowEnter.append("path").attr("class", "wf-cluster-shape");
        workflowEnter.append("text").attr("class", "wf-cluster-label")
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

          let d = "";
          if (points.length === 2) {
            const cx = (points[0][0] + points[1][0]) / 2;
            const cy = (points[0][1] + points[1][1]) / 2;
            const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
            const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
            d = `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`;
          } else {
            const hull = polygonHull(points);
            if (hull) {
              const centroid = polygonCentroid(hull);
              const expanded = hull.map(([x, y]) => {
                const dx = x - centroid[0];
                const dy = y - centroid[1];
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const pad = GRAPH.collideRadius;
                return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
              });
              d = `M${expanded.map((p) => p.join(",")).join("L")}Z`;
            }
          }

          g.select<SVGPathElement>("path.wf-cluster-shape")
            .attr("d", d)
            .attr("fill", `${wfColor}08`)
            .attr("stroke", wfColor)
            .attr("stroke-width", isSelectedWorkflow ? 2 : 1)
            .attr("stroke-opacity", isSelectedWorkflow ? 0.6 : 0.25)
            .attr("stroke-linejoin", "round");

          const label = g.select<SVGTextElement>("text.wf-cluster-label");
          if (run) {
            let minY = Infinity;
            for (const p of points) if (p[1] < minY) minY = p[1];
            if (minY === Infinity) minY = 0;
            const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
            label
              .attr("x", avgX)
              .attr("y", minY - GRAPH.collideRadius - 8)
              .attr("fill", wfColor)
              .attr("opacity", isSelectedWorkflow ? 0.9 : 0.5)
              .text(`⚙ ${run.name}`);
          } else {
            label.text("");
          }
        });

        // Phase centroid labels inside workflow clusters
        workflowMerged.each(function ([runId, runNodes]) {
          const g = select(this);
          const run = workflows.get(runId);
          if (!run || run.phases.length === 0) return;

          // Group run nodes by phaseTitle
          const nodesByPhase = new Map<string, SimNode[]>();
          for (const node of runNodes) {
            const phaseTitle = agentIdToPhaseTitle.get(node.id);
            if (!phaseTitle) continue;
            const list = nodesByPhase.get(phaseTitle) ?? [];
            list.push(node);
            nodesByPhase.set(phaseTitle, list);
          }

          // Join phase labels
          const phaseData = Array.from(nodesByPhase.entries()).filter(
            ([, ns]) => ns.every((n) => n.x != null && n.y != null),
          );

          const phaseLabels = g.selectAll<SVGTextElement, [string, SimNode[]]>("text.phase-label")
            .data(phaseData, (d) => d[0]);
          phaseLabels.exit().remove();
          phaseLabels.enter().append("text")
            .attr("class", "phase-label")
            .attr("text-anchor", "middle")
            .attr("font-family", "monospace")
            .attr("font-size", 8)
            .merge(phaseLabels)
            .each(function ([phaseTitle, phaseNodes]) {
              const avgX = phaseNodes.reduce((s, n) => s + n.x!, 0) / phaseNodes.length;
              const avgY = phaseNodes.reduce((s, n) => s + n.y!, 0) / phaseNodes.length;
              select(this)
                .attr("x", avgX)
                .attr("y", avgY - 18)
                .attr("fill", WORKFLOW_COLOR)
                .attr("opacity", 0.5)
                .text(phaseTitle);
            });
        });
      });

    refs.simulationRef.current = simulation;
    return () => { simulation.stop(); };
    // Intentional: closure over selectedAgentId/selectedTeamId/selectedWorkflowId/
    // teams/workflows/agents is fine because Effect 2b handles agents/selectedAgentId;
    // the tick handler re-reads selectedTeamId/teams/selectedWorkflowId/workflows
    // from closure on every simulation tick.
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
