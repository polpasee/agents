import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { GRAPH } from "@/lib/config";

// All vi.mock factories must use only inline vi.fn() — no outer variables
// (hoisting restriction). We retrieve the mocks after import via vi.mocked().

vi.mock("d3-selection", () => ({
  select: vi.fn(() => ({
    transition: vi.fn(() => ({
      duration: vi.fn(() => ({
        call: vi.fn(),
      })),
    })),
  })),
}));

vi.mock("d3-transition", () => ({}));

vi.mock("d3-zoom", () => ({
  zoomIdentity: {
    translate: vi.fn(() => ({
      scale: vi.fn(() => ({
        translate: vi.fn(() => ({ _tag: "transform" })),
      })),
    })),
  },
}));

import { useFitToView } from "../useFitToView";
import { select as mockSelect } from "d3-selection";
import { zoomIdentity } from "d3-zoom";
import type { AgentGraphRefs } from "../refs";
import type { SimNode } from "@/lib/d3";

function makeSvgEl(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

function makeContainerDiv(w = 800, h = 600): HTMLDivElement {
  const div = document.createElement("div");
  Object.defineProperty(div, "clientWidth", { get: () => w });
  Object.defineProperty(div, "clientHeight", { get: () => h });
  return div;
}

function makeRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeRefs(overrides: Partial<AgentGraphRefs> = {}): AgentGraphRefs {
  return {
    svgRef: makeRef(makeSvgEl()),
    containerRef: makeRef(makeContainerDiv()),
    simulationRef: makeRef(null),
    nodesRef: makeRef([]),
    linksRef: makeRef([]),
    toolNodesRef: makeRef([]),
    toolLinksRef: makeRef([]),
    zoomRef: makeRef({
      transform: vi.fn(),
    } as unknown as import("d3-zoom").ZoomBehavior<SVGSVGElement, unknown>),
    effectsRef: makeRef([]),
    prevActivityLenRef: makeRef(0),
    ...overrides,
  };
}

function makeNode(x?: number, y?: number): SimNode {
  return { id: "a", agent: { id: "a" } as SimNode["agent"], x, y } as SimNode;
}

/** Rebuild the mock chain so each test starts fresh */
function resetSelectMock() {
  const callFn = vi.fn();
  const durationFn = vi.fn(() => ({ call: callFn }));
  const transitionFn = vi.fn(() => ({ duration: durationFn }));
  vi.mocked(mockSelect).mockReturnValue({
    transition: transitionFn,
  } as unknown as ReturnType<typeof mockSelect>);
  return { callFn, durationFn, transitionFn };
}

describe("useFitToView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a stable callback reference across re-renders", () => {
    const refs = makeRefs();
    const { result, rerender } = renderHook(() => useFitToView(refs));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("does nothing when svgRef is null", () => {
    resetSelectMock();
    const refs = makeRefs({ svgRef: makeRef(null) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when containerRef is null", () => {
    resetSelectMock();
    const refs = makeRefs({ containerRef: makeRef(null) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when zoomRef is null", () => {
    resetSelectMock();
    const refs = makeRefs({ zoomRef: makeRef(null) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when nodes array is empty", () => {
    resetSelectMock();
    const refs = makeRefs({ nodesRef: makeRef([]) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does nothing when all nodes lack x/y coordinates", () => {
    resetSelectMock();
    const refs = makeRefs({ nodesRef: makeRef([makeNode()]) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("calls select(svg) → transition() → duration(d) → call() when nodes have positions", () => {
    const { callFn, durationFn, transitionFn } = resetSelectMock();
    const refs = makeRefs({ nodesRef: makeRef([makeNode(100, 200)]) });
    const { result } = renderHook(() => useFitToView(refs));

    result.current(750);

    expect(mockSelect).toHaveBeenCalledWith(refs.svgRef.current);
    expect(transitionFn).toHaveBeenCalled();
    expect(durationFn).toHaveBeenCalledWith(750);
    expect(callFn).toHaveBeenCalled();
  });

  it("uses the default duration of 500 when called with no argument", () => {
    const { durationFn } = resetSelectMock();
    const refs = makeRefs({ nodesRef: makeRef([makeNode(0, 0)]) });
    const { result } = renderHook(() => useFitToView(refs));

    result.current();

    expect(durationFn).toHaveBeenCalledWith(500);
  });

  it("clamps the computed scale within GRAPH.zoomExtent bounds", () => {
    resetSelectMock();

    let capturedScale: number | undefined;
    const translateResult = {
      scale: vi.fn((s: number) => {
        capturedScale = s;
        return { translate: vi.fn(() => ({ _tag: "transform" })) };
      }),
    };
    vi.mocked(zoomIdentity.translate).mockReturnValue(
      translateResult as unknown as ReturnType<typeof zoomIdentity.translate>,
    );

    // Single node at origin — tiny bounding box → natural scale is huge → clamped
    const refs = makeRefs({ nodesRef: makeRef([makeNode(0, 0)]) });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();

    expect(capturedScale).toBeDefined();
    expect(capturedScale!).toBeLessThanOrEqual(GRAPH.zoomExtent[1]);
    expect(capturedScale!).toBeGreaterThanOrEqual(GRAPH.zoomExtent[0]);
  });

  it("builds the transform with viewport-centre translation and bbox-centre negation", () => {
    resetSelectMock();

    // Capture the argument to the outermost zoomIdentity.translate(w/2, h/2)
    const outerTranslateArgs: Array<[number, number]> = [];
    // Capture the argument to the inner .scale().translate(-cx, -cy)
    const innerTranslateArgs: Array<[number, number]> = [];
    const innerTranslate = vi.fn((x: number, y: number) => {
      innerTranslateArgs.push([x, y]);
      return { _tag: "transform" };
    });
    vi.mocked(zoomIdentity.translate).mockImplementation(
      (x: number, y: number) => {
        outerTranslateArgs.push([x, y]);
        return {
          scale: vi.fn(() => ({ translate: innerTranslate })),
        } as unknown as ReturnType<typeof zoomIdentity.translate>;
      },
    );

    // Two nodes symmetric around (0,0) — bbox centre is (0,0)
    const refs = makeRefs({
      nodesRef: makeRef([makeNode(-50, -50), makeNode(50, 50)]),
    });
    const { result } = renderHook(() => useFitToView(refs));
    result.current();

    // zoomIdentity.translate is called with viewport centre: width/2, height/2
    expect(outerTranslateArgs[0]).toEqual([400, 300]); // 800/2, 600/2
    // The chained .scale().translate() is called with -cx, -cy (bbox centre = 0,0)
    expect(innerTranslateArgs[0]).toEqual([-0, -0]);
  });
});
