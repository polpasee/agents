import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState } from "@/lib/types";
import type { AgentGraphRefs } from "../refs";
import type { SimNode, SimLink } from "@/lib/d3";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// All vi.mock factories must be self-contained (hoisted before imports).

vi.mock("d3-force", () => ({
  forceSimulation: vi.fn(),
  forceLink: vi.fn(),
  forceManyBody: vi.fn(),
  forceX: vi.fn(),
  forceY: vi.fn(),
  forceCollide: vi.fn(),
}));

vi.mock("d3-selection", () => {
  const makeSel = (): Record<string, unknown> => ({
    attr: vi.fn().mockReturnThis(),
    each: vi.fn().mockReturnThis(),
    empty: vi.fn(() => false),
    remove: vi.fn().mockReturnThis(),
    append: vi.fn(() => makeSel()),
    selectAll: vi.fn(() => makeSel()),
    select: vi.fn(() => makeSel()),
    data: vi.fn(() => makeSel()),
    join: vi.fn(() => makeSel()),
    call: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    merge: vi.fn(() => makeSel()),
    enter: vi.fn(() => makeSel()),
    exit: vi.fn(() => ({ remove: vi.fn() })),
    text: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
  });
  return { select: vi.fn(() => makeSel()) };
});

vi.mock("@/lib/colors", () => ({
  agentColor: vi.fn(() => "#0f0"),
  UI: { text: { secondary: "#aaa" } },
}));

vi.mock("@/lib/config", () => ({
  GRAPH: {
    toolWindowMs: 15_000,
    toolMaxPerAgent: 5,
    toolNodeRadius: 14,
    newNodeAlpha: 0.3,
  },
  getNodeRadius: vi.fn(() => 42),
}));

vi.mock("@/lib/d3/endpointId", () => ({
  endpointId: (n: unknown) =>
    typeof n === "string" ? n : (n as { id: string }).id,
}));

vi.mock("../simulationDrag", () => ({
  simulationDrag: vi.fn(() => vi.fn()),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { select as d3Select } from "d3-selection";
import { useToolNodesEffect } from "../useToolNodesEffect";

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

function makeMockSim() {
  const linkForceMock = { links: vi.fn().mockReturnThis() };
  return {
    nodes: vi.fn().mockReturnThis(),
    alpha: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
    force: vi.fn().mockReturnValue(linkForceMock),
    _linkForceMock: linkForceMock,
  };
}

function makeRefs(partial: Partial<AgentGraphRefs> = {}): AgentGraphRefs {
  const sim = makeMockSim();
  return {
    svgRef: makeRef(
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      ) as SVGSVGElement,
    ),
    containerRef: makeRef(document.createElement("div")),
    simulationRef: makeMutableRef(
      sim as unknown as import("d3-force").Simulation<SimNode, SimLink>,
    ),
    nodesRef: makeMutableRef<SimNode[]>([]),
    linksRef: makeMutableRef<SimLink[]>([]),
    toolNodesRef: makeMutableRef<SimNode[]>([]),
    toolLinksRef: makeMutableRef<SimLink[]>([]),
    zoomRef: makeMutableRef(null),
    effectsRef: makeMutableRef([]),
    prevActivityLenRef: makeMutableRef(0),
    ...partial,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useToolNodesEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when simulationRef is null", () => {
    const refs = makeRefs({ simulationRef: makeMutableRef(null) });
    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", makeAgent()]]) }),
    );
    // d3Select should not be called — the hook returns early
    expect(vi.mocked(d3Select)).not.toHaveBeenCalled();
  });

  it("does nothing when svgRef is null", () => {
    const refs = makeRefs({ svgRef: makeRef(null) });
    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", makeAgent()]]) }),
    );
    expect(vi.mocked(d3Select)).not.toHaveBeenCalled();
  });

  it("produces no tool nodes when agent has no tool calls", () => {
    const agent = makeAgent({ id: "a1", toolCalls: [] });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(0);
    expect(refs.toolLinksRef.current).toHaveLength(0);
  });

  it("emits a tool node for an agent with a recent tool call", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 1000 }],
    });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(1);
    expect(refs.toolNodesRef.current[0]?.toolCall?.tool).toBe("bash");
  });

  it("does not emit tool nodes for agents not in nodesRef (filtered out)", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 1000 }],
    });
    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([]) });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(0);
  });

  it("ignores tool calls outside the time window (> toolWindowMs)", () => {
    const staleTs = Date.now() - 20_000;
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "old_tool", timestamp: staleTs }],
    });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(0);
  });

  it("caps tool nodes at toolMaxPerAgent (5) per agent", () => {
    const now = Date.now();
    const toolCalls = Array.from({ length: 10 }, (_, i) => ({
      tool: `tool${i}`,
      timestamp: now - i * 100,
    }));
    const agent = makeAgent({ id: "a1", toolCalls });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current.length).toBeLessThanOrEqual(5);
  });

  it("does not emit tool nodes for completed agents (only running|idle allowed)", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      status: "completed",
      toolCalls: [{ tool: "bash", timestamp: now - 1000 }],
    });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(0);
  });

  it("does emit tool nodes for idle agents (idle is allowed)", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      status: "idle",
      toolCalls: [{ tool: "read", timestamp: now - 1000 }],
    });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(1);
  });

  it("calls simulation.nodes() with combined agent + tool nodes", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 1000 }],
    });
    const agentNode: SimNode = { id: "a1", agent } as SimNode;
    const sim = makeMockSim();
    const refs = makeRefs({
      simulationRef: makeMutableRef(
        sim as unknown as import("d3-force").Simulation<SimNode, SimLink>,
      ),
      nodesRef: makeMutableRef<SimNode[]>([agentNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(sim.nodes).toHaveBeenCalledOnce();
    const arg = sim.nodes.mock.calls[0]![0] as SimNode[];
    expect(arg.length).toBeGreaterThanOrEqual(2);
    expect(arg.some((n) => n.id === "a1")).toBe(true);
  });

  it("calls simulation.alpha().restart() when tool node set changes", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 500 }],
    });
    const sim = makeMockSim();
    const refs = makeRefs({
      simulationRef: makeMutableRef(
        sim as unknown as import("d3-force").Simulation<SimNode, SimLink>,
      ),
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
      toolNodesRef: makeMutableRef<SimNode[]>([]), // was empty → changed
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(sim.alpha).toHaveBeenCalled();
    expect(sim.restart).toHaveBeenCalled();
  });

  it("does NOT restart simulation when tool node set is unchanged", () => {
    const now = Date.now();
    const toolTs = now - 500;
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: toolTs }],
    });
    const toolNodeId = `tool:a1:${toolTs}`;
    const existingToolNode: SimNode = {
      id: toolNodeId,
      agent,
      toolCall: { tool: "bash", timestamp: toolTs, parentAgentId: "a1" },
    } as SimNode;

    const sim = makeMockSim();
    const refs = makeRefs({
      simulationRef: makeMutableRef(
        sim as unknown as import("d3-force").Simulation<SimNode, SimLink>,
      ),
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
      toolNodesRef: makeMutableRef<SimNode[]>([existingToolNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(sim.restart).not.toHaveBeenCalled();
  });

  it("reuses existing tool node object when id matches (not re-created)", () => {
    const now = Date.now();
    const toolTs = now - 500;
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: toolTs }],
    });
    const toolNodeId = `tool:a1:${toolTs}`;
    const existingToolNode: SimNode = {
      id: toolNodeId,
      agent,
      toolCall: { tool: "bash", timestamp: toolTs, parentAgentId: "a1" },
    } as SimNode;

    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
      toolNodesRef: makeMutableRef<SimNode[]>([existingToolNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current[0]).toBe(existingToolNode);
  });

  it("removes tool nodes when agent tool calls clear (exit path)", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 500 }],
    });
    const agentNode: SimNode = { id: "a1", agent } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([agentNode]),
    });

    const { rerender } = renderHook(
      ({ agents }: { agents: Map<string, AgentState> }) =>
        useToolNodesEffect(refs, { agents }),
      { initialProps: { agents: new Map([["a1", agent]]) } },
    );

    expect(refs.toolNodesRef.current).toHaveLength(1);

    const clearedAgent = makeAgent({ id: "a1", toolCalls: [] });
    rerender({ agents: new Map([["a1", clearedAgent]]) });

    expect(refs.toolNodesRef.current).toHaveLength(0);
    expect(refs.toolLinksRef.current).toHaveLength(0);
  });

  it("tool node inherits depth from its owner agent's SimNode", () => {
    // Guards Edit 1: the tool node's .depth must equal the owner SimNode's .depth
    // so that toolRestRadius(toolNode) == toolRestRadius(ownerNode) at every nesting level.
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      parentId: "parent",
      toolCalls: [{ tool: "bash", timestamp: now - 500 }],
    });
    // Owner SimNode with depth=1 (as set by useTopologyEffect for a direct sub-agent)
    const ownerNode: SimNode = { id: "a1", agent, depth: 1 } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([ownerNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolNodesRef.current).toHaveLength(1);
    expect(refs.toolNodesRef.current[0]?.depth).toBe(1);
  });

  it("emits a tool link from agent to tool node with edgeType 'tool'", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "glob", timestamp: now - 1000 }],
    });
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(refs.toolLinksRef.current).toHaveLength(1);
    const link = refs.toolLinksRef.current[0]!;
    expect(link.source).toBe("a1");
    expect(link.edgeType).toBe("tool");
  });

  it("calls simulation.force('link') to update link force with combined links", () => {
    const now = Date.now();
    const agent = makeAgent({
      id: "a1",
      toolCalls: [{ tool: "bash", timestamp: now - 500 }],
    });
    const sim = makeMockSim();
    const refs = makeRefs({
      simulationRef: makeMutableRef(
        sim as unknown as import("d3-force").Simulation<SimNode, SimLink>,
      ),
      nodesRef: makeMutableRef<SimNode[]>([{ id: "a1", agent } as SimNode]),
    });

    renderHook(() =>
      useToolNodesEffect(refs, { agents: new Map([["a1", agent]]) }),
    );

    expect(sim.force).toHaveBeenCalledWith("link");
    expect(sim._linkForceMock.links).toHaveBeenCalledOnce();
  });
});
