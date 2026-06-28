import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ForceLink, ForceCollide } from "d3-force";
import { GRAPH } from "@/lib/config";
import { depthFactor } from "@/lib/d3/depth";
import type {
  SimNode,
  SimLink,
  GroupedManyBodyForce,
  RadialSpokesForce,
} from "@/lib/d3";
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
      refs.simulationRef.current!.force<GroupedManyBodyForce<SimNode>>(
        "charge",
      )!;
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

  it("tool nodes spoke outward via toolSpokes force, inner-seeded tool ends up beyond its owner", () => {
    // Topology: main M (no parentId), sub-agent S (parentId=M).
    // S is pinned at (200,0), M at (0,0) → outward direction is +x.
    // Tool node seeded INSIDE at x=150 (< S.x=200) so a no-op force or the
    // old full-circle n=1 (-π/2 → target x=200,y=-55) both fail the
    // assertion; only the outward fan (angle=0 → target x=255) passes.
    const M = mockAgent({ id: "M" });
    const S = mockAgent({ id: "S", parentId: "M" });
    const agentMap = new Map<string, AgentState>([
      ["M", M],
      ["S", S],
    ]);
    const refs = makeRefs();

    renderHook(() =>
      useTopologyEffect(refs, {
        filteredAgents: [M, S],
        edges: [],
        agents: agentMap,
        teams: new Map(),
        workflows: new Map(),
        selectedAgentId: null,
        selectedTeamId: null,
        selectedWorkflowId: null,
        topologyVersion: 1,
        selectAgent: vi.fn(),
      }),
    );

    const sim = refs.simulationRef.current!;

    // Pin M and S at known positions; set both x and fx so the force reads them.
    const mNode = refs.nodesRef.current.find((n) => n.id === "M")!;
    const sNode = refs.nodesRef.current.find((n) => n.id === "S")!;
    mNode.x = 0;
    mNode.y = 0;
    mNode.fx = 0;
    mNode.fy = 0;
    sNode.x = 200;
    sNode.y = 0;
    sNode.fx = 200;
    sNode.fy = 0;

    // Inject a tool node owned by S, seeded on the INNER side.
    const toolNode: SimNode = {
      id: "tool:S:1",
      agent: S,
      toolCall: { tool: "Read", timestamp: Date.now(), parentAgentId: "S" },
      x: 150,
      y: 0,
      vx: 0,
      vy: 0,
    };

    // Drive the "toolSpokes" force (not "spokes").
    const toolSpokesForce =
      sim.force<RadialSpokesForce<SimNode>>("toolSpokes")!;
    toolSpokesForce.initialize([...refs.nodesRef.current, toolNode]);

    // Run many ticks to let the force converge.
    for (let i = 0; i < 500; i++) {
      toolSpokesForce(0.3);
      toolNode.x = (toolNode.x ?? 0) + (toolNode.vx ?? 0);
      toolNode.y = (toolNode.y ?? 0) + (toolNode.vy ?? 0);
      toolNode.vx = (toolNode.vx ?? 0) * 0.6;
      toolNode.vy = (toolNode.vy ?? 0) * 0.6;
    }

    // Tool must end up beyond its owner S (which is pinned at x=200).
    expect(toolNode.x).toBeGreaterThan(sNode.x!);
  });

  it("tool owned by a sub-agent is excluded from the spokes group, so two sub-agents still fan ~180° apart", () => {
    // Regression guard for the slot-separation invariant. M owns S1,S2 → spokes
    // group n=2 → targets are vertical (180° apart). A tool OWNED BY S1
    // (tool.agent.parentId === "M") is fed into the spokes force: it must be
    // excluded via !n.toolCall so the group stays n=2. If tools were merged into
    // spokes, n=3 → S1/S2 ~120° apart → assertion fails. S1/S2 are seeded CLUMPED
    // on one side so a no-op/disabled spokes force also fails (they'd stay clumped).
    const M = mockAgent({ id: "M" });
    const S1 = mockAgent({ id: "S1", parentId: "M" });
    const S2 = mockAgent({ id: "S2", parentId: "M" });
    const agentMap = new Map<string, AgentState>([
      ["M", M],
      ["S1", S1],
      ["S2", S2],
    ]);
    const refs = makeRefs();

    renderHook(() =>
      useTopologyEffect(refs, {
        filteredAgents: [M, S1, S2],
        edges: [],
        agents: agentMap,
        teams: new Map(),
        workflows: new Map(),
        selectedAgentId: null,
        selectedTeamId: null,
        selectedWorkflowId: null,
        topologyVersion: 1,
        selectAgent: vi.fn(),
      }),
    );

    const sim = refs.simulationRef.current!;
    const mNode = refs.nodesRef.current.find((n) => n.id === "M")!;
    const s1Node = refs.nodesRef.current.find((n) => n.id === "S1")!;
    const s2Node = refs.nodesRef.current.find((n) => n.id === "S2")!;

    // Pin M at origin; seed S1/S2 CLUMPED on the +x upper side (not antipodal).
    mNode.x = 0;
    mNode.y = 0;
    s1Node.x = 100;
    s1Node.y = 12;
    s1Node.vx = 0;
    s1Node.vy = 0;
    s2Node.x = 96;
    s2Node.y = 20;
    s2Node.vx = 0;
    s2Node.vy = 0;

    // Tool OWNED BY S1 — its spokes key would be M (S1.parentId) if the
    // !n.toolCall exclusion were removed, so a re-merge would push the group to n=3.
    const toolNode: SimNode = {
      id: "tool:S1:1",
      agent: S1,
      toolCall: { tool: "Read", timestamp: Date.now(), parentAgentId: "S1" },
      x: 50,
      y: 0,
      vx: 0,
      vy: 0,
    };

    const spokeForce = sim.force<RadialSpokesForce<SimNode>>("spokes")!;
    spokeForce.initialize([mNode, s1Node, s2Node, toolNode]);

    for (let i = 0; i < 500; i++) {
      spokeForce(0.5);
      for (const n of [s1Node, s2Node]) {
        n.x = (n.x ?? 0) + (n.vx ?? 0);
        n.y = (n.y ?? 0) + (n.vy ?? 0);
        n.vx = (n.vx ?? 0) * 0.6;
        n.vy = (n.vy ?? 0) * 0.6;
      }
    }

    const angle1 = Math.atan2(s1Node.y ?? 0, s1Node.x ?? 0);
    const angle2 = Math.atan2(s2Node.y ?? 0, s2Node.x ?? 0);
    let diff = Math.abs(angle1 - angle2);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect(Math.abs(diff - Math.PI)).toBeLessThan(0.3);
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

    // The strength accessor must also route injected tool links to the
    // tool branch (not the message/blocking peer fallthrough).
    const strength = linkForce.strength();
    expect(strength(toolLink, 0, links)).toBe(GRAPH.toolLinkStrength);
  });
});
