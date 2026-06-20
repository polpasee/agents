import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// vi.mock is hoisted — factories must use only inline vi.fn()
vi.mock("d3-selection", () => ({
  select: vi.fn(() => ({
    selectAll: vi.fn(() => ({ attr: vi.fn().mockReturnThis() })),
    select: vi.fn(() => ({
      empty: vi.fn(() => false),
      selectAll: vi.fn(() => ({ attr: vi.fn().mockReturnThis() })),
    })),
  })),
}));

vi.mock("@/lib/d3/layouts", () => ({
  applyTreeLayout: vi.fn(),
  applyRadialLayout: vi.fn(),
  applyHierarchicalLayout: vi.fn(),
}));

vi.mock("@/lib/d3", () => ({
  linkPath: vi.fn(() => "M0,0L1,1"),
}));

import { useLayoutModeEffect } from "../useLayoutModeEffect";
import { select as mockSelect } from "d3-selection";
import {
  applyTreeLayout,
  applyRadialLayout,
  applyHierarchicalLayout,
} from "@/lib/d3/layouts";
import type { AgentGraphRefs } from "../refs";
import type { SimNode } from "@/lib/d3";
import type { GraphLayout } from "@/lib/types";

function makeRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeSvgEl(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

function makeContainerDiv(w = 800, h = 600): HTMLDivElement {
  const div = document.createElement("div");
  div.getBoundingClientRect = vi.fn().mockReturnValue({ width: w, height: h });
  return div;
}

function makeMockSimulation() {
  return {
    alpha: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
    stop: vi.fn(),
  };
}

function makeNode(id: string, x = 0, y = 0): SimNode {
  return {
    id,
    agent: { id, parentId: undefined } as SimNode["agent"],
    x,
    y,
  } as SimNode;
}

function makeRefs(overrides: Partial<AgentGraphRefs> = {}): AgentGraphRefs {
  return {
    svgRef: makeRef(makeSvgEl()),
    containerRef: makeRef(makeContainerDiv()),
    simulationRef: makeRef(
      makeMockSimulation() as unknown as import("d3-force").Simulation<
        SimNode,
        import("@/lib/d3").SimLink
      >,
    ),
    nodesRef: makeRef([makeNode("a"), makeNode("b")]),
    linksRef: makeRef([]),
    toolNodesRef: makeRef([]),
    toolLinksRef: makeRef([]),
    zoomRef: makeRef(null),
    effectsRef: makeRef([]),
    prevActivityLenRef: makeRef(0),
    ...overrides,
  };
}

function opts(graphLayout: GraphLayout, topologyVersion = 1) {
  return { graphLayout, topologyVersion };
}

/** Rebuild the d3-selection mock chain after vi.clearAllMocks() */
function resetSelectMock() {
  vi.mocked(mockSelect).mockReturnValue({
    selectAll: vi.fn(() => ({ attr: vi.fn().mockReturnThis() })),
    select: vi.fn(() => ({
      empty: vi.fn(() => false),
      selectAll: vi.fn(() => ({ attr: vi.fn().mockReturnThis() })),
    })),
  } as unknown as ReturnType<typeof mockSelect>);
}

describe("useLayoutModeEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectMock();
  });

  it("does nothing when simulation is null", () => {
    const refs = makeRefs({ simulationRef: makeRef(null) });
    renderHook(() => useLayoutModeEffect(refs, opts("force")));
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when container is null", () => {
    const refs = makeRefs({ containerRef: makeRef(null) });
    renderHook(() => useLayoutModeEffect(refs, opts("force")));
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when svg is null", () => {
    const refs = makeRefs({ svgRef: makeRef(null) });
    renderHook(() => useLayoutModeEffect(refs, opts("force")));
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when nodes array is empty", () => {
    const refs = makeRefs({ nodesRef: makeRef([]) });
    renderHook(() => useLayoutModeEffect(refs, opts("force")));
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("force layout: unfixes all nodes fx/fy to null", () => {
    const nodeA = makeNode("a");
    const nodeB = makeNode("b");
    nodeA.fx = 10;
    nodeA.fy = 20;
    const sim = makeMockSimulation();
    const refs = makeRefs({
      nodesRef: makeRef([nodeA, nodeB]),
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });

    renderHook(() => useLayoutModeEffect(refs, opts("force")));

    expect(nodeA.fx).toBeNull();
    expect(nodeA.fy).toBeNull();
    expect(nodeB.fx).toBeNull();
    expect(nodeB.fy).toBeNull();
  });

  it("force layout: calls alpha(0.5).restart() on the simulation", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });

    renderHook(() => useLayoutModeEffect(refs, opts("force")));

    expect(sim.alpha).toHaveBeenCalledWith(0.5);
    expect(sim.restart).toHaveBeenCalled();
  });

  it("force layout: does NOT call any static layout function", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });
    renderHook(() => useLayoutModeEffect(refs, opts("force")));

    expect(applyTreeLayout).not.toHaveBeenCalled();
    expect(applyRadialLayout).not.toHaveBeenCalled();
    expect(applyHierarchicalLayout).not.toHaveBeenCalled();
  });

  it("tree layout: stops simulation and calls applyTreeLayout with dimensions", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });
    renderHook(() => useLayoutModeEffect(refs, opts("tree")));

    expect(sim.stop).toHaveBeenCalled();
    expect(applyTreeLayout).toHaveBeenCalledWith(
      refs.nodesRef.current,
      800,
      600,
    );
    expect(applyRadialLayout).not.toHaveBeenCalled();
    expect(applyHierarchicalLayout).not.toHaveBeenCalled();
  });

  it("radial layout: stops simulation and calls applyRadialLayout with dimensions", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });
    renderHook(() => useLayoutModeEffect(refs, opts("radial")));

    expect(sim.stop).toHaveBeenCalled();
    expect(applyRadialLayout).toHaveBeenCalledWith(
      refs.nodesRef.current,
      800,
      600,
    );
    expect(applyTreeLayout).not.toHaveBeenCalled();
    expect(applyHierarchicalLayout).not.toHaveBeenCalled();
  });

  it("hierarchical layout: stops simulation and calls applyHierarchicalLayout with dimensions", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });
    renderHook(() => useLayoutModeEffect(refs, opts("hierarchical")));

    expect(sim.stop).toHaveBeenCalled();
    expect(applyHierarchicalLayout).toHaveBeenCalledWith(
      refs.nodesRef.current,
      800,
      600,
    );
    expect(applyTreeLayout).not.toHaveBeenCalled();
    expect(applyRadialLayout).not.toHaveBeenCalled();
  });

  it("static layout: uses d3-selection to update SVG node transforms", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });
    renderHook(() => useLayoutModeEffect(refs, opts("tree")));

    expect(mockSelect).toHaveBeenCalledWith(refs.svgRef.current);
  });

  it("re-runs when topologyVersion changes", () => {
    const sim = makeMockSimulation();
    const refs = makeRefs({
      simulationRef: makeRef(
        sim as unknown as import("d3-force").Simulation<
          SimNode,
          import("@/lib/d3").SimLink
        >,
      ),
    });

    const { rerender } = renderHook(
      ({ v }: { v: number }) => useLayoutModeEffect(refs, opts("tree", v)),
      { initialProps: { v: 1 } },
    );

    vi.clearAllMocks();
    resetSelectMock();

    rerender({ v: 2 });

    expect(applyTreeLayout).toHaveBeenCalled();
  });
});
