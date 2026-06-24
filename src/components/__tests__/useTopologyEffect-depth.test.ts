import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ForceLink, ForceCollide } from "d3-force";
import { GRAPH } from "@/lib/config";
import { depthFactor } from "@/lib/d3/depth";
import type { SimNode, SimLink, GroupedManyBodyForce } from "@/lib/d3";
import type { AgentState, EdgeState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";
import { useTopologyEffect } from "../AgentGraph/useTopologyEffect";
import type { AgentGraphRefs } from "../AgentGraph/refs";

/**
 * Depth plumbing through the topology rebuild: SimNodes must carry their
 * nesting depth, and the link force's distance accessor must scale parent
 * links by depthFactor(target depth) while leaving tool/message links on
 * their flat constants.
 *
 * The hook is driven directly (renderHook) against hand-built refs — the
 * same real-d3-in-jsdom approach as AgentGraph.test.tsx, no d3 mocking.
 * Forces are reached through d3-force's public API: simulationRef →
 * force("link") → .distance() returns the accessor.
 */

function makeRefs(): AgentGraphRefs {
  const container = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  return {
    svgRef: { current: svg },
    containerRef: { current: container },
    simulationRef: { current: null },
    nodesRef: { current: [] },
    linksRef: { current: [] },
    toolNodesRef: { current: [] },
    toolLinksRef: { current: [] },
    zoomRef: { current: null },
    effectsRef: { current: [] },
    prevActivityLenRef: { current: 0 },
  };
}

/**
 * 3-level chain main → mid → leaf, plus a second root (`peer`) connected to
 * main by a message edge so the accessor sees a non-parent agent link too,
 * plus a team member (`tm`, also at depth 2) which must NOT depth-scale.
 */
function buildChainTopology() {
  const main = mockAgent({ id: "main" });
  const mid = mockAgent({ id: "mid", parentId: "main" });
  const leaf = mockAgent({ id: "leaf", parentId: "mid" });
  const peer = mockAgent({ id: "peer" });
  const tm = mockAgent({ id: "tm", parentId: "mid", teamId: "team-A" });
  const agents = new Map<string, AgentState>([
    ["main", main],
    ["mid", mid],
    ["leaf", leaf],
    ["peer", peer],
    ["tm", tm],
  ]);
  const edges: EdgeState[] = [
    { source: "main", target: "peer", edgeType: "message" },
  ];
  const refs = makeRefs();

  renderHook(() =>
    useTopologyEffect(refs, {
      filteredAgents: [main, mid, leaf, peer, tm],
      edges,
      agents,
      teams: new Map(),
      workflows: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
      selectedWorkflowId: null,
      topologyVersion: 1,
      selectAgent: vi.fn(),
    }),
  );

  return { refs, main };
}

function getLinkForce(refs: AgentGraphRefs): ForceLink<SimNode, SimLink> {
  const force =
    refs.simulationRef.current!.force<ForceLink<SimNode, SimLink>>("link");
  expect(force).toBeDefined();
  return force!;
}

describe("useTopologyEffect — depth plumbing", () => {
  it("assigns nesting depth 0/1/2 to the SimNodes of a main → mid → leaf chain", () => {
    const { refs } = buildChainTopology();

    const depthById = new Map(
      refs.nodesRef.current.map((n) => [n.id, n.depth]),
    );
    expect(depthById.get("main")).toBe(0);
    expect(depthById.get("mid")).toBe(1);
    expect(depthById.get("leaf")).toBe(2);
    expect(depthById.get("peer")).toBe(0);
  });

  it("assigns nesting depth 2 to a team member nested under a sub-agent", () => {
    const { refs } = buildChainTopology();
    const tm = refs.nodesRef.current.find((n) => n.id === "tm")!;
    expect(tm.depth).toBe(2);
  });

  it("scales parent-link distance by depthFactor(target depth) and keeps message links flat", () => {
    const { refs } = buildChainTopology();

    const linkForce = getLinkForce(refs);
    const distance = linkForce.distance();
    const links = linkForce.links(); // source/target resolved to SimNodes by d3

    const toLeaf = links.find(
      (l) => l.edgeType === "parent" && (l.target as SimNode).id === "leaf",
    )!;
    const toMid = links.find(
      (l) => l.edgeType === "parent" && (l.target as SimNode).id === "mid",
    )!;
    const message = links.find((l) => l.edgeType === "message")!;
    expect(toLeaf).toBeDefined();
    expect(toMid).toBeDefined();
    expect(message).toBeDefined();

    // Depth-2 target: shrunk by the per-level factor — NOT the flat constant.
    expect(distance(toLeaf, 0, links)).toBe(
      GRAPH.subAgentLinkDistance * depthFactor(2),
    );
    expect(distance(toLeaf, 0, links)).not.toBe(GRAPH.subAgentLinkDistance);

    // Depth-1 target: depthFactor(1) === 1, so exactly the flat constant.
    expect(distance(toMid, 0, links)).toBe(GRAPH.subAgentLinkDistance);

    // Message links never depth-scale.
    expect(distance(message, 0, links)).toBe(GRAPH.linkDistance);
  });

  it("keeps parent-link distance flat for team-member targets at depth >= 2", () => {
    const { refs } = buildChainTopology();

    const linkForce = getLinkForce(refs);
    const distance = linkForce.distance();
    const links = linkForce.links();

    const toTm = links.find(
      (l) => l.edgeType === "parent" && (l.target as SimNode).id === "tm",
    )!;
    expect(toTm).toBeDefined();
    // Team members render full-size, so their links must not depth-scale.
    expect(distance(toTm, 0, links)).toBe(GRAPH.subAgentLinkDistance);
  });

  it("depth-scales charge for nested sub-agents but not for team members", () => {
    const { refs } = buildChainTopology();
    const nodes = refs.nodesRef.current;
    const leaf = nodes.find((n) => n.id === "leaf")!;
    const tm = nodes.find((n) => n.id === "tm")!;

    const charge =
      refs.simulationRef.current!.force<GroupedManyBodyForce<SimNode>>("charge")!;
    const strength = charge.strength();
    expect(strength(leaf)).toBe(GRAPH.chargeStrengthSubAgent * depthFactor(2));
    expect(strength(tm)).toBe(GRAPH.chargeStrengthSubAgent);
  });

  it("depth-scales collide radius for nested sub-agents but not for team members", () => {
    const { refs } = buildChainTopology();
    const nodes = refs.nodesRef.current;
    const leaf = nodes.find((n) => n.id === "leaf")!;
    const tm = nodes.find((n) => n.id === "tm")!;

    const collide =
      refs.simulationRef.current!.force<ForceCollide<SimNode>>("collide")!;
    const radius = collide.radius();
    expect(radius(leaf, 0, nodes)).toBe(
      GRAPH.subAgentNodeRadius * depthFactor(2) + 4,
    );
    // Team members render at the full main-agent radius, depth ignored.
    expect(radius(tm, 0, nodes)).toBe(GRAPH.nodeRadius + 4);
  });

  it("returns GRAPH.toolLinkDistance for tool links fed into the same link force", () => {
    const { refs, main } = buildChainTopology();

    const sim = refs.simulationRef.current!;
    const linkForce = getLinkForce(refs);

    // Mirror useToolNodesEffect: add a tool node to the simulation and
    // re-feed links through the SAME "link" force (string endpoints are
    // resolved by d3 on assignment).
    const toolNode: SimNode = {
      id: "tool:main:1",
      agent: main,
      toolCall: { tool: "Read", timestamp: Date.now(), parentAgentId: "main" },
    };
    sim.nodes([...refs.nodesRef.current, toolNode]);
    linkForce.links([
      ...refs.linksRef.current,
      { source: "main", target: "tool:main:1", edgeType: "tool" },
    ]);

    const distance = linkForce.distance();
    const links = linkForce.links();
    const toolLink = links.find((l) => l.edgeType === "tool")!;
    expect(toolLink).toBeDefined();
    expect(distance(toolLink, 0, links)).toBe(GRAPH.toolLinkDistance);
  });
});
