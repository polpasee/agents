/**
 * useTopologyEffect — TICK INTERIOR tests
 *
 * Strategy: capture the tick callback registered via simulation.on('tick', fn),
 * then invoke it directly. d3-selection is NOT mocked so real SVG DOM mutations
 * happen in jsdom — that's how linkPath/clusterHullPath/clusterLabelAnchor get
 * called (the d3 attr accessors execute with the bound data).
 *
 * We DO mock d3-force (so no real physics), @/lib/d3 (so clusterHullPath etc.
 * are spies), and other heavy deps.  The hook constructs real SVG sub-groups via
 * the un-mocked d3-selection so the tick body can traverse them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState, WorkflowRunState, TeamState } from "@/lib/types";
import type { AgentGraphRefs } from "../refs";
import type { SimNode, SimLink } from "@/lib/d3";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Capture the registered tick handler so tests can invoke it.
let capturedTickFn: (() => void) | null = null;

vi.mock("d3-force", () => {
  const makeSimulation = () => {
    const sim: Record<string, unknown> = {};
    sim["force"] = vi.fn().mockReturnThis();
    sim["nodes"] = vi.fn().mockReturnThis();
    sim["on"] = vi.fn().mockImplementation((event: string, fn: () => void) => {
      if (event === "tick") capturedTickFn = fn;
      return sim;
    });
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

// d3-zoom: must return a callable function (d3svg.call(zoomBehavior) invokes it).
vi.mock("d3-zoom", () => ({
  zoom: vi.fn(() => {
    // The zoom behavior is called by d3.call(behavior) — it must be a function
    // with chained methods.  Use Object.assign to avoid TS property errors on
    // the vi.fn() mock type.
    const behavior = Object.assign(vi.fn(), {
      scaleExtent: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      transform: vi.fn().mockReturnThis(),
    });
    return behavior;
  }),
}));

// @/lib/d3: spy versions so we can assert calls.
vi.mock("@/lib/d3", () => ({
  renderNodeVisuals: vi.fn(),
  updateLinkVisuals: vi.fn(),
  bezierPath: vi.fn(() => "M0,0"),
  linkPath: vi.fn(() => "M0,0"),
  clusterHullPath: vi.fn(() => "M0,0"),
  clusterLabelAnchor: vi.fn(() => ({ x: 50, y: 50 })),
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
import { linkPath, clusterHullPath, clusterLabelAnchor } from "@/lib/d3";
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

function makeRefs(): AgentGraphRefs {
  return {
    svgRef: makeRef(makeSvg()),
    containerRef: makeRef(makeContainer()),
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

function makeWorkflowRun(
  runId: string,
  agentRefs: WorkflowRunState["agents"] = [],
  phases: WorkflowRunState["phases"] = [],
): WorkflowRunState {
  return {
    runId,
    sessionId: "sess-1",
    name: "test-workflow",
    status: "running",
    startTime: Date.now(),
    agentCount: agentRefs.length,
    phases,
    agents: agentRefs,
  };
}

function makeTeam(id: string, name: string): TeamState {
  return {
    id,
    name,
    memberIds: [],
    status: "active",
    task: "team task",
    startTime: Date.now(),
  };
}

function makeOpts(
  filteredAgents: AgentState[] = [],
  overrides: Partial<{
    edges: import("@/lib/types").EdgeState[];
    agents: Map<string, AgentState>;
    teams: Map<string, TeamState>;
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
    edges: [] as import("@/lib/types").EdgeState[],
    agents: new Map<string, AgentState>(filteredAgents.map((a) => [a.id, a])),
    teams: new Map<string, TeamState>(),
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

describe("useTopologyEffect — tick interior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTickFn = null;
  });

  it("registers a tick callback on the simulation", () => {
    const agent = makeAgent({ id: "a1" });
    renderHook(() => useTopologyEffect(makeRefs(), makeOpts([agent])));
    expect(capturedTickFn).toBeTypeOf("function");
  });

  it("tick: calls linkPath for each link via the attr accessor", () => {
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
    expect(capturedTickFn).not.toBeNull();
    // Position all nodes
    for (const n of refs.nodesRef.current) {
      n.x = 100;
      n.y = 100;
    }
    // The links are stored with string source/target IDs (linksRef) but the tick
    // body operates on SVG path elements whose data was bound at build time.
    // Simply invoke the tick — the real d3 attr accessor will call linkPath for
    // each bound SimLink datum in the rendered selection.
    capturedTickFn!();
    // linkPath is called inside linkGlow.attr("d", (d) => (d.pathD = linkPath(d)))
    // The real d3-selection attr with a function calls linkPath for each datum.
    expect(vi.mocked(linkPath)).toHaveBeenCalled();
  });

  it("tick: does not throw for nodes without x/y (simulation still warming)", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));
    expect(() => capturedTickFn?.()).not.toThrow();
  });

  it("tick: calls clusterHullPath for team clusters with ≥2 members", () => {
    const team = makeTeam("t1", "Alpha");
    const a1 = makeAgent({ id: "a1", teamId: "t1" });
    const a2 = makeAgent({ id: "a2", teamId: "t1" });

    const refs = makeRefs();
    const opts = makeOpts([a1, a2], {
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["t1", team]]),
    });
    renderHook(() => useTopologyEffect(refs, opts));

    // Position nodes so hull path receives valid coordinate data
    for (const n of refs.nodesRef.current) {
      n.x = 100;
      n.y = 200;
    }
    capturedTickFn!();
    expect(vi.mocked(clusterHullPath)).toHaveBeenCalled();
  });

  it("tick: calls clusterLabelAnchor when team is present and has ≥2 members", () => {
    const team = makeTeam("t1", "Beta");
    const a1 = makeAgent({ id: "a1", teamId: "t1", agentType: "team-lead" });
    const a2 = makeAgent({ id: "a2", teamId: "t1" });

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          teams: new Map([["t1", team]]),
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 50;
      n.y = 50;
    }
    capturedTickFn!();
    expect(vi.mocked(clusterLabelAnchor)).toHaveBeenCalled();
  });

  it("tick: skips team cluster label when team is NOT in teams map", () => {
    const a1 = makeAgent({ id: "a1", teamId: "ghost-team" });
    const a2 = makeAgent({ id: "a2", teamId: "ghost-team" });

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          teams: new Map(), // no matching team
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 10;
      n.y = 10;
    }
    expect(() => capturedTickFn!()).not.toThrow();
    // clusterLabelAnchor not called because team is absent
    expect(vi.mocked(clusterLabelAnchor)).not.toHaveBeenCalled();
  });

  it("tick: updates workflow cluster hulls when ≥2 agents belong to the same run", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const wf = makeWorkflowRun("run1", [
      { agentId: "a1", label: "step-A", state: "running" },
      { agentId: "a2", label: "step-B", state: "running" },
    ]);

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          workflows: new Map([["run1", wf]]),
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 100;
      n.y = 100;
    }
    capturedTickFn!();
    expect(vi.mocked(clusterHullPath)).toHaveBeenCalled();
  });

  it("tick: renders phase-centroid labels when run has phases and agents are positioned", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const wf = makeWorkflowRun(
      "run1",
      [
        { agentId: "a1", label: "s1", phaseTitle: "Phase-A", state: "running" },
        { agentId: "a2", label: "s2", phaseTitle: "Phase-A", state: "running" },
      ],
      [{ index: 0, title: "Phase-A" }],
    );

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          workflows: new Map([["run1", wf]]),
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 200;
      n.y = 200;
    }

    capturedTickFn!();

    // clusterHullPath is called to draw the workflow cluster hull
    expect(vi.mocked(clusterHullPath)).toHaveBeenCalled();

    // A text.phase-label element for "Phase-A" was appended inside the workflow g
    const svg = refs.svgRef.current!;
    const phaseLabel = svg.querySelector("text.phase-label");
    expect(phaseLabel).not.toBeNull();
    expect(phaseLabel?.textContent).toBe("Phase-A");
  });

  it("tick: skips workflow cluster when only 1 agent is in the run", () => {
    const a1 = makeAgent({ id: "a1" });
    const wf = makeWorkflowRun("run1", [
      { agentId: "a1", label: "only", state: "running" },
    ]);

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1], {
          agents: new Map([["a1", a1]]),
          workflows: new Map([["run1", wf]]),
        }),
      ),
    );

    refs.nodesRef.current[0]!.x = 50;
    refs.nodesRef.current[0]!.y = 50;
    capturedTickFn!();
    // With only 1 agent, workflowEntries is empty → clusterHullPath not called
    expect(vi.mocked(clusterHullPath)).not.toHaveBeenCalled();
  });

  it("tick: node transform is applied on every tick call (no throw on repeated calls)", () => {
    const agent = makeAgent({ id: "a1" });
    const refs = makeRefs();
    renderHook(() => useTopologyEffect(refs, makeOpts([agent])));
    expect(() => {
      capturedTickFn!();
      capturedTickFn!();
    }).not.toThrow();
  });

  it("tick: tool-link geometry runs without error when source/target have x/y", () => {
    const a1 = makeAgent({ id: "a1" });
    const refs = makeRefs();

    renderHook(() => useTopologyEffect(refs, makeOpts([a1])));

    // Inject a tool link with resolved objects (mimics what forceLink does)
    const mockSource: Partial<SimNode> = { id: "tool1", x: 10, y: 10 };
    const mockTarget: Partial<SimNode> = { id: "a1", x: 100, y: 100 };
    refs.linksRef.current = [
      {
        source: mockSource as SimNode,
        target: mockTarget as SimNode,
        edgeType: "tool",
      } as SimLink,
    ];

    expect(() => capturedTickFn!()).not.toThrow();
  });

  it("tick: tool-link each() short-circuits gracefully when source.x is null", () => {
    const a1 = makeAgent({ id: "a1" });
    const refs = makeRefs();

    renderHook(() => useTopologyEffect(refs, makeOpts([a1])));

    const mockSource: Partial<SimNode> = {
      id: "tool1",
      x: undefined,
      y: undefined,
    };
    const mockTarget: Partial<SimNode> = { id: "a1", x: 100, y: 100 };
    refs.linksRef.current = [
      {
        source: mockSource as SimNode,
        target: mockTarget as SimNode,
        edgeType: "tool",
      } as SimLink,
    ];

    expect(() => capturedTickFn!()).not.toThrow();
  });

  it("tick: workflow cluster renders with selectedWorkflowId matching the run", () => {
    const a1 = makeAgent({ id: "a1" });
    const a2 = makeAgent({ id: "a2" });
    const wf = makeWorkflowRun("run1", [
      { agentId: "a1", label: "s1", state: "running" },
      { agentId: "a2", label: "s2", state: "running" },
    ]);

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          workflows: new Map([["run1", wf]]),
          selectedWorkflowId: "run1",
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 80;
      n.y = 80;
    }

    capturedTickFn!();

    // When selectedWorkflowId matches the run, stroke-width must be 2 (highlighted)
    const svg = refs.svgRef.current!;
    const wfShape = svg.querySelector("path.wf-cluster-shape");
    expect(wfShape).not.toBeNull();
    expect(wfShape?.getAttribute("stroke-width")).toBe("2");

    // clusterLabelAnchor is called so the label is positioned
    expect(vi.mocked(clusterLabelAnchor)).toHaveBeenCalled();
  });

  it("tick: team cluster still renders even when teamId not in teams (hull + no label)", () => {
    // Team hull is built for teams with ≥2 members, but the label only shows when
    // the team object exists in the teams map.  Here we test the no-team path.
    const a1 = makeAgent({ id: "a1", teamId: "absent-team" });
    const a2 = makeAgent({ id: "a2", teamId: "absent-team" });

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(
        refs,
        makeOpts([a1, a2], {
          agents: new Map([
            ["a1", a1],
            ["a2", a2],
          ]),
          teams: new Map(),
        }),
      ),
    );

    for (const n of refs.nodesRef.current) {
      n.x = 60;
      n.y = 60;
    }
    capturedTickFn!();
    // clusterHullPath still called (hull renders regardless of teams map)
    expect(vi.mocked(clusterHullPath)).toHaveBeenCalled();
    // but clusterLabelAnchor is NOT called (label skipped when team absent)
    expect(vi.mocked(clusterLabelAnchor)).not.toHaveBeenCalled();
  });
});
