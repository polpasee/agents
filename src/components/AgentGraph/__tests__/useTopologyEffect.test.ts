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
      links: vi.fn().mockReturnThis(),
    })),
    forceManyBody: vi.fn(() => ({
      distanceMax: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
    })),
    forceX: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
    forceY: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
    forceCollide: vi.fn(() => ({ radius: vi.fn().mockReturnThis() })),
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
    subAgentLinkDistance: 200,
    linkDistance: 300,
    toolLinkDistance: 80,
    chargeDistanceMax: 500,
    chargeStrengthMain: -500,
    chargeStrengthSubAgent: -200,
    chargeStrengthTool: -80,
    centerStrength: 0.05,
    toolNodeRadius: 14,
  },
  getNodeRadius: vi.fn(() => 42),
}));

vi.mock("../simulationDrag", () => ({
  simulationDrag: vi.fn(() => vi.fn()),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { forceSimulation } from "d3-force";
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
