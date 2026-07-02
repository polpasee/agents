import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState, EdgeState, WorkflowRunState } from "@/lib/types";
import type { AgentGraphRefs } from "../refs";
import type { SimNode, SimLink } from "@/lib/d3";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// All vi.mock factories must be self-contained (hoisted before imports).
// We access spies via vi.mocked() after import.

vi.mock("d3-force", () => {
  // The hook chains: forceSimulation(nodes).force("link", ...).force("charge", ...)...
  // so .force() must return `this` (the simulation).
  const makeSimulation = () => {
    const sim: Record<string, unknown> = {};
    // .force() is called both to set forces (returns `this`) and to retrieve
    // them (e.g. simulation.force("link") returns the force object). We need it
    // to return `this` for the chain calls that immediately follow construction.
    // The only retrieval call is in useToolNodesEffect; this hook never retrieves.
    sim["force"] = vi.fn().mockReturnThis();
    sim["nodes"] = vi.fn().mockReturnThis();
    sim["on"] = vi.fn().mockReturnThis();
    sim["alpha"] = vi.fn().mockReturnThis();
    sim["restart"] = vi.fn().mockReturnThis();
    sim["stop"] = vi.fn();
    return sim;
  };
  return {
    forceSimulation: vi.fn(() => makeSimulation()),
    forceLink: vi.fn(() => ({
      id: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      links: vi.fn().mockReturnThis(),
    })),
    forceX: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
    forceY: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
    forceCollide: vi.fn(() => ({ radius: vi.fn().mockReturnThis() })),
    forceManyBody: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
      distanceMax: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock("d3-selection", () => {
  const makeSel = (): Record<string, unknown> => ({
    attr: vi.fn().mockReturnThis(),
    selectAll: vi.fn(() => makeSel()),
    select: vi.fn(() => makeSel()),
    append: vi.fn(() => makeSel()),
    data: vi.fn(() => makeSel()),
    join: vi.fn(() => makeSel()),
    each: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    empty: vi.fn(() => false),
    merge: vi.fn(() => makeSel()),
    enter: vi.fn(() => makeSel()),
    exit: vi.fn(() => makeSel()),
    text: vi.fn().mockReturnThis(),
  });
  return {
    select: vi.fn(() => makeSel()),
    zoom: vi.fn(() => ({
      scaleExtent: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock("d3-zoom", () => ({
  zoom: vi.fn(() => ({
    scaleExtent: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("@/lib/d3", () => ({
  renderNodeVisuals: vi.fn(),
  updateLinkVisuals: vi.fn(),
  bezierPath: vi.fn(() => "M0,0"),
  linkPath: vi.fn(() => "M0,0"),
  clusterHullPath: vi.fn(() => "M0,0"),
  clusterLabelAnchor: vi.fn(() => ({ x: 0, y: 0 })),
  agentDepth: vi.fn(() => 0),
  depthFactor: vi.fn(() => 1),
  rootAgentId: vi.fn((id: string) => id),
  forceGroupedManyBody: vi.fn(() => ({
    distanceMax: vi.fn().mockReturnThis(),
    strength: vi.fn().mockReturnThis(),
  })),
  forceRadialSpokes: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  hexPath: vi.fn(() => "M0,0"),
}));

vi.mock("@/lib/workflowLabels", () => ({
  buildWorkflowLabelMap: vi.fn(() => new Map<string, string>()),
}));

vi.mock("@/lib/colors", () => ({
  agentColor: vi.fn(() => "#0f0"),
  UI: { primary: "#fff", text: { empty: "#999", secondary: "#aaa" } },
  EDGE_COLORS: { blocking: "#f00" },
  WORKFLOW_COLOR: "#a855f7",
}));

vi.mock("@/lib/config", () => ({
  GRAPH: {
    zoomExtent: [0.15, 4],
    newNodeAlpha: 0.3,
    nodeRadius: 42,
    subAgentLinkDistance: 160,
    linkDistance: 150,
    toolGap: 28,
    chargeDistanceMax: 320,
    chargeStrengthMain: -260,
    chargeStrengthSubAgent: -150,
    chargeStrengthTool: -55,
    chargeStrengthGlobal: -80,
    chargeGlobalDistanceMax: 120,
    centerStrength: 0.08,
    subAgentCenterStrength: 0.015,
    toolNodeRadius: 14,
    parentLinkStrength: 0.85,
    peerLinkStrength: 0.08,
    toolLinkStrength: 0.7,
    spokeStrength: 0.25,
  },
  getNodeRadius: vi.fn(() => 42),
}));

vi.mock("../simulationDrag", () => ({
  simulationDrag: vi.fn(() => vi.fn()),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { forceSimulation, forceX, forceY, forceManyBody } from "d3-force";
import { select as d3Select } from "d3-selection";
import { updateLinkVisuals } from "@/lib/d3";
import { buildWorkflowLabelMap } from "@/lib/workflowLabels";
import { useTopologyEffect } from "../useTopologyEffect";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeRef<T>(val: T): React.RefObject<T> {
  return { current: val } as React.RefObject<T>;
}

function makeMutableRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeSvg(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  Object.defineProperty(div, "clientWidth", { get: () => 800 });
  Object.defineProperty(div, "clientHeight", { get: () => 600 });
  return div;
}

function makeRefs(
  svg: SVGSVGElement | null = makeSvg(),
  container: HTMLDivElement | null = makeContainer(),
): AgentGraphRefs {
  return {
    svgRef: makeRef(svg),
    containerRef: makeRef(container),
    simulationRef: makeMutableRef<
      import("d3-force").Simulation<SimNode, SimLink> | null
    >(null),
    nodesRef: makeMutableRef<SimNode[]>([]),
    linksRef: makeMutableRef<SimLink[]>([]),
    toolNodesRef: makeMutableRef<SimNode[]>([]),
    toolLinksRef: makeMutableRef<SimLink[]>([]),
    zoomRef: makeMutableRef(null),
    effectsRef: makeMutableRef([]),
    prevActivityLenRef: makeMutableRef(0),
  };
}

function makeOpts(
  filteredAgents: AgentState[] = [],
  overrides: Partial<{
    edges: EdgeState[];
    agents: Map<string, AgentState>;
    teams: Map<string, import("@/lib/types").TeamState>;
    workflows: Map<string, WorkflowRunState>;
    selectedAgentId: string | null;
    selectedTeamId: string | null;
    selectedWorkflowId: string | null;
    topologyVersion: number;
    selectAgent: (id: string | null) => void;
  }> = {},
) {
  return {
    filteredAgents,
    edges: [] as EdgeState[],
    agents: new Map<string, AgentState>(filteredAgents.map((a) => [a.id, a])),
    teams: new Map<string, import("@/lib/types").TeamState>(),
    workflows: new Map<string, WorkflowRunState>(),
    selectedAgentId: null as string | null,
    selectedTeamId: null as string | null,
    selectedWorkflowId: null as string | null,
    topologyVersion: 1,
    selectAgent: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTopologyEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when svgRef is null", () => {
    const refs = makeRefs(null, makeContainer());
    renderHook(() => useTopologyEffect(refs, makeOpts()));
    expect(vi.mocked(forceSimulation)).not.toHaveBeenCalled();
  });

  it("does nothing when containerRef is null", () => {
    const refs = makeRefs(makeSvg(), null);
    renderHook(() => useTopologyEffect(refs, makeOpts()));
    expect(vi.mocked(forceSimulation)).not.toHaveBeenCalled();
  });

  it("creates a force simulation when agents are present", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));
    expect(vi.mocked(forceSimulation)).toHaveBeenCalledOnce();
  });

  it("registers a chargeGlobal forceManyBody force with the weak all-pairs config", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));

    const sim = refs.simulationRef.current as unknown as {
      force: { mock: { calls: unknown[][] } };
    };
    const chargeGlobalCall = sim.force.mock.calls.find(
      (call) => call[0] === "chargeGlobal",
    );
    expect(chargeGlobalCall).toBeDefined();

    const forceInstance = vi.mocked(forceManyBody).mock.results[0]!.value as {
      strength: { mock: { calls: unknown[][] } };
      distanceMax: { mock: { calls: unknown[][] } };
    };
    // The registered force must be the exact instance forceManyBody() returned.
    expect(chargeGlobalCall![1]).toBe(forceInstance);
    expect(forceInstance.distanceMax.mock.calls[0]![0]).toBe(120);

    // strength is an accessor: 0 for tools (already leashed to their owner),
    // GRAPH.chargeStrengthGlobal for every other agent node.
    const strengthOf = forceInstance.strength.mock.calls[0]![0] as (
      d: SimNode,
    ) => number;
    const toolNode = {
      id: "t",
      agent: makeAgent({ id: "a1" }),
      toolCall: { tool: "Read", timestamp: 0, parentAgentId: "a1" },
    } as SimNode;
    const agentNode = { id: "a1", agent: makeAgent({ id: "a1" }) } as SimNode;
    expect(strengthOf(toolNode)).toBe(0);
    expect(strengthOf(agentNode)).toBe(-80);
  });

  it("applies weak viewport-centering to sub-agents, full to mains/teams, none to tools", () => {
    // Regression: a sub-agent whose parent is present is anchored by the parent
    // link + spokes. A full forceX/forceY pull dragged it onto the center-facing
    // arc and clumped siblings on one side, so it gets a much weaker pull. An
    // orphan (parent not rendered) has no such anchor and keeps the full pull.
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([
          makeAgent({ id: "m" }),
          makeAgent({ id: "s", parentId: "m" }),
        ]),
      ),
    );

    // forceX and forceY must share the same strength accessor — capture both.
    const captureStrength = (force: {
      mock: { results: { value: unknown }[] };
    }) =>
      (
        force.mock.results[0]!.value as {
          strength: { mock: { calls: unknown[][] } };
        }
      ).strength.mock.calls[0]![0] as (d: SimNode) => number;
    const centerStrengthOf = captureStrength(vi.mocked(forceX));
    // Guards the Y-axis half of the fix: both axes use the identical accessor.
    expect(captureStrength(vi.mocked(forceY))).toBe(centerStrengthOf);

    const toolNode = {
      id: "t",
      agent: makeAgent({ id: "a1" }),
      toolCall: { tool: "Read", timestamp: 0, parentAgentId: "a1" },
    } as SimNode;
    const mainNode = { id: "m", agent: makeAgent({ id: "m" }) } as SimNode;
    const subAgentNode = {
      id: "s",
      agent: makeAgent({ id: "s", parentId: "m" }),
    } as SimNode;
    const teamNode = {
      id: "tm",
      agent: makeAgent({ id: "tm", parentId: "m", teamId: "team1" }),
    } as SimNode;
    // Orphan: parent "ghost" was evicted, so it is not in the rendered set.
    const orphanNode = {
      id: "o",
      agent: makeAgent({ id: "o", parentId: "ghost" }),
    } as SimNode;

    expect(centerStrengthOf(toolNode)).toBe(0);
    expect(centerStrengthOf(mainNode)).toBe(0.08);
    expect(centerStrengthOf(subAgentNode)).toBe(0.015);
    // Team members render full-size and center like mains, not sub-agents.
    expect(centerStrengthOf(teamNode)).toBe(0.08);
    // Orphaned sub-agent keeps the full pull — it has no parent link or spoke.
    expect(centerStrengthOf(orphanNode)).toBe(0.08);
  });

  it("writes nodes to refs from filteredAgents", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
        }),
      ),
    );
    expect(refs.nodesRef.current).toHaveLength(2);
  });

  it("builds a parent link for agent with parentId in filteredAgents", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2", parentId: "a1" });
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
        }),
      ),
    );
    expect(refs.linksRef.current).toHaveLength(1);
    expect(refs.linksRef.current[0]).toMatchObject({
      source: "a1",
      target: "a2",
      edgeType: "parent",
    });
  });

  it("includes message edges when both endpoints are in filteredAgents", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const edges: EdgeState[] = [
      { source: "a1", target: "a2", edgeType: "message" },
    ];
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          edges,
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
        }),
      ),
    );
    expect(refs.linksRef.current.some((l) => l.edgeType === "message")).toBe(
      true,
    );
  });

  it("includes blocking edges when both endpoints are in filteredAgents", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const edges: EdgeState[] = [
      { source: "a1", target: "a2", edgeType: "blocking" },
    ];
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          edges,
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
        }),
      ),
    );
    expect(refs.linksRef.current.some((l) => l.edgeType === "blocking")).toBe(
      true,
    );
  });

  it("excludes edges when one endpoint is filtered out", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const edges: EdgeState[] = [
      { source: "a1", target: "a2", edgeType: "message" },
    ];
    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1], {
          // a2 not in filteredAgents
          edges,
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
        }),
      ),
    );
    expect(refs.linksRef.current).toHaveLength(0);
  });

  it("carries forward previous node positions into the new node list", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    refs.nodesRef.current = [{ id: "a1", agent, x: 123, y: 456 } as SimNode];

    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));

    const newNode = refs.nodesRef.current.find((n) => n.id === "a1");
    expect(newNode?.x).toBe(123);
    expect(newNode?.y).toBe(456);
  });

  it("calls updateLinkVisuals after building the link group", () => {
    const a1 = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([a1])));
    expect(vi.mocked(updateLinkVisuals)).toHaveBeenCalled();
  });

  it("calls d3 select on the SVG element", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));
    expect(vi.mocked(d3Select)).toHaveBeenCalled();
  });

  it("sets simulationRef.current after the simulation is created", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));
    expect(refs.simulationRef.current).not.toBeNull();
  });

  it("stops simulation on cleanup", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    const { unmount } = renderHook(() =>
      useTopologyEffect(refs, makeOpts([agent])),
    );
    const sim = refs.simulationRef.current;
    unmount();
    // After cleanup the stop method on the simulation should have been called
    expect(sim?.stop).toHaveBeenCalled();
  });

  it("assigns workflowLabel when buildWorkflowLabelMap returns a label for the node", () => {
    vi.mocked(buildWorkflowLabelMap).mockReturnValueOnce(
      new Map([["a1", "find:scan-A"]]),
    );

    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));

    expect(refs.nodesRef.current[0]?.workflowLabel).toBe("find:scan-A");
  });

  it("does not set workflowLabel when no label is returned for the node", () => {
    vi.mocked(buildWorkflowLabelMap).mockReturnValueOnce(new Map());

    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));

    expect(refs.nodesRef.current[0]?.workflowLabel).toBeUndefined();
  });

  it("re-runs the effect when topologyVersion changes", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    const { rerender } = renderHook(
      ({ version }: { version: number }) =>
        useTopologyEffect(
          refs,
          makeOpts([agent], { topologyVersion: version }),
        ),
      { initialProps: { version: 1 } },
    );

    const callsBefore = vi.mocked(forceSimulation).mock.calls.length;
    rerender({ version: 2 });
    expect(vi.mocked(forceSimulation).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("re-runs the effect when filteredAgents.length changes", () => {
    const a1 = makeAgent({ id: "a1" });
    const refs = makeRefs();
    const { rerender } = renderHook(
      ({ agents }: { agents: AgentState[] }) =>
        useTopologyEffect(refs, makeOpts(agents)),
      { initialProps: { agents: [a1] } },
    );

    const callsBefore = vi.mocked(forceSimulation).mock.calls.length;
    const a2 = makeAgent({ id: "a2" });
    rerender({ agents: [a1, a2] });
    expect(vi.mocked(forceSimulation).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("does not create a simulation when filteredAgents is empty", () => {
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([])));
    expect(vi.mocked(forceSimulation)).not.toHaveBeenCalled();
  });
});
