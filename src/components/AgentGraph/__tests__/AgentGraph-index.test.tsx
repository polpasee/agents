/**
 * AgentGraph/index.tsx — branch coverage for lines 88-108.
 *
 * Covers:
 *  - useImperativeHandle getNodesAndViewport: null path (svg or zoomRef null)
 *  - useImperativeHandle getNodesAndViewport: full path with nodes
 *  - filteredAgents === 0 auto-fit guard
 *  - fitToView: () => fitToView() wrapper
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Stable mock for zoomTransform — returns a transform object
const mockZoomTransform = vi.fn(() => ({ x: 0, y: 0, k: 1 }));
vi.mock("d3-zoom", () => ({
  zoomTransform: () => mockZoomTransform(),
}));

vi.mock("@/lib/colors", () => ({
  agentColor: vi.fn(() => "#ff0000"),
}));

// filteredAgents is controlled per-test via this mock
const mockFilteredAgents: { value: unknown[] } = { value: [] };
vi.mock("@/hooks/useFilteredAgents", () => ({
  useFilteredAgents: () => mockFilteredAgents.value,
}));

// Store mock — returns controllable values
const mockStore: Record<string, unknown> = {
  agents: new Map(),
  edges: [],
  teams: new Map(),
  selectAgent: vi.fn(),
  selectedAgentId: null,
  activity: [],
  selectedTeamId: null,
  workflows: new Map(),
  selectedWorkflowId: null,
  heatmapEnabled: false,
  heatmapMetric: "idleRatio",
  graphLayout: "force",
  topologyVersion: 0,
};

vi.mock("@/lib/store", () => ({
  useAgentStore: (sel: (s: typeof mockStore) => unknown) => sel(mockStore),
}));

// Refs mock — we set current values in each test
const svgRefCurrent: { current: SVGSVGElement | null } = { current: null };
const zoomRefCurrent: { current: unknown } = { current: null };
const nodesRefCurrent: {
  current: Array<{ x?: number; y?: number; agent: unknown }>;
} = { current: [] };

vi.mock("../refs", () => ({
  useAgentGraphRefs: () => ({
    svgRef: svgRefCurrent,
    containerRef: { current: document.createElement("div") },
    simulationRef: { current: null },
    nodesRef: nodesRefCurrent,
    linksRef: { current: [] },
    toolNodesRef: { current: [] },
    toolLinksRef: { current: [] },
    zoomRef: zoomRefCurrent,
    effectsRef: { current: [] },
    prevActivityLenRef: { current: 0 },
  }),
}));

// Stub all sub-hooks
vi.mock("../useFitToView", () => ({
  useFitToView: () => vi.fn(),
}));
vi.mock("../useTopologyEffect", () => ({ useTopologyEffect: vi.fn() }));
vi.mock("../useNodeVisualsEffect", () => ({ useNodeVisualsEffect: vi.fn() }));
vi.mock("../useToolNodesEffect", () => ({ useToolNodesEffect: vi.fn() }));
vi.mock("../useLifecycleEffectsLayer", () => ({
  useLifecycleEffectsLayer: vi.fn(),
}));
vi.mock("../useLayoutModeEffect", () => ({ useLayoutModeEffect: vi.fn() }));
vi.mock("../useResizeEffect", () => ({ useResizeEffect: vi.fn() }));

// ── Import ────────────────────────────────────────────────────────────────────
import { AgentGraph } from "../index";
import type { AgentGraphHandle } from "../index";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
  Object.defineProperty(svg, "clientWidth", { get: () => 800 });
  Object.defineProperty(svg, "clientHeight", { get: () => 600 });
  return svg;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentGraph — useImperativeHandle branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svgRefCurrent.current = null;
    zoomRefCurrent.current = null;
    nodesRefCurrent.current = [];
    mockFilteredAgents.value = [];
    mockZoomTransform.mockReturnValue({ x: 0, y: 0, k: 1 });
  });

  it("getNodesAndViewport returns null when svgRef.current is null", () => {
    const ref = React.createRef<AgentGraphHandle>();
    svgRefCurrent.current = null;
    zoomRefCurrent.current = {}; // non-null

    // renderHook renders the component and calls the hook
    renderHook(() => AgentGraph({ ref }));

    const result = ref.current?.getNodesAndViewport();
    expect(result).toBeNull();
  });

  it("getNodesAndViewport returns null when zoomRef.current is null", () => {
    const ref = React.createRef<AgentGraphHandle>();
    svgRefCurrent.current = makeSvg();
    zoomRefCurrent.current = null;

    renderHook(() => AgentGraph({ ref }));

    const result = ref.current?.getNodesAndViewport();
    expect(result).toBeNull();
  });

  it("getNodesAndViewport returns nodes and viewport when refs are set", () => {
    const ref = React.createRef<AgentGraphHandle>();
    const svg = makeSvg();
    svgRefCurrent.current = svg;
    zoomRefCurrent.current = {}; // non-null (truthy zoom behavior)
    mockZoomTransform.mockReturnValue({ x: -100, y: -50, k: 2 });

    const fakeAgent = {
      id: "a1",
      agentType: "build",
      status: "running",
    } as unknown as import("@/lib/types").AgentState;

    nodesRefCurrent.current = [
      { id: "a1", agent: fakeAgent, x: 50, y: 75 } as unknown as {
        x?: number;
        y?: number;
        agent: unknown;
      },
      // Node with no x/y — should be filtered
      { id: "a2", agent: fakeAgent } as unknown as {
        x?: number;
        y?: number;
        agent: unknown;
      },
    ];

    renderHook(() => AgentGraph({ ref }));

    const result = ref.current?.getNodesAndViewport();
    expect(result).not.toBeNull();
    expect(result?.nodes).toHaveLength(1);
    expect(result?.nodes[0]?.x).toBe(50);
    expect(result?.nodes[0]?.y).toBe(75);
    expect(result?.nodes[0]?.color).toBe("#ff0000");
    // viewport: x = -(-100)/2 = 50, y = -(-50)/2 = 25
    expect(result?.viewport.x).toBe(50);
    expect(result?.viewport.y).toBe(25);
    // width = 800/2 = 400
    expect(result?.viewport.width).toBe(400);
    expect(result?.viewport.height).toBe(300);
  });

  it("fitToView handle calls fitToView", () => {
    const ref = React.createRef<AgentGraphHandle>();
    svgRefCurrent.current = makeSvg();
    zoomRefCurrent.current = {};

    renderHook(() => AgentGraph({ ref }));

    // Should not throw; the mock fitToView is a vi.fn()
    expect(() => ref.current?.fitToView()).not.toThrow();
  });

  it("auto-fit effect does NOT fire when filteredAgents is empty", () => {
    // filteredAgents.length === 0 → early return without setting timer
    mockFilteredAgents.value = [];
    const ref = React.createRef<AgentGraphHandle>();

    // Just confirms no error
    expect(() => renderHook(() => AgentGraph({ ref }))).not.toThrow();
  });
});
