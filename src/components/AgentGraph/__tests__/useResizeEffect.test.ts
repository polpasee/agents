import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// vi.mock is hoisted before variable declarations — use only inline vi.fn()
vi.mock("d3-selection", () => ({
  select: vi.fn(() => ({
    attr: vi.fn().mockReturnThis(),
  })),
}));

import { useResizeEffect } from "../useResizeEffect";
import { select as mockSelect } from "d3-selection";
import type { AgentGraphRefs } from "../refs";

// Minimal ResizeObserver stub
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  private cb: ResizeObserverCallback;
  observed: Element[] = [];
  disconnect = vi.fn();

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  triggerResize(width: number, height: number) {
    this.cb(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function makeRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeContainerDiv(w = 640, h = 480): HTMLDivElement {
  const div = document.createElement("div");
  div.getBoundingClientRect = vi.fn().mockReturnValue({ width: w, height: h });
  return div;
}

function makeSvgEl(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
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
    zoomRef: makeRef(null),
    effectsRef: makeRef([]),
    prevActivityLenRef: makeRef(0),
    ...overrides,
  };
}

describe("useResizeEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    // Rebuild attr chain after clearAllMocks
    const attrChain = { attr: vi.fn().mockReturnThis() };
    vi.mocked(mockSelect).mockReturnValue(
      attrChain as unknown as ReturnType<typeof mockSelect>,
    );
  });

  it("creates a ResizeObserver that observes the container element", () => {
    const refs = makeRefs();
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    expect(MockResizeObserver.instances.length).toBe(1);
    expect(MockResizeObserver.instances[0]!.observed).toContain(
      refs.containerRef.current,
    );
  });

  it("does not create an observer when containerRef is null", () => {
    const refs = makeRefs({ containerRef: makeRef(null) });
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    expect(MockResizeObserver.instances.length).toBe(0);
    expect(fitToView).not.toHaveBeenCalled();
  });

  it("does not create an observer when svgRef is null", () => {
    const refs = makeRefs({ svgRef: makeRef(null) });
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    expect(MockResizeObserver.instances.length).toBe(0);
  });

  it("on resize: calls select(svg) and sets width and height attributes", () => {
    const attrMock = vi.fn().mockReturnThis();
    vi.mocked(mockSelect).mockReturnValue({
      attr: attrMock,
    } as unknown as ReturnType<typeof mockSelect>);

    const refs = makeRefs({
      containerRef: makeRef(makeContainerDiv(1024, 768)),
    });
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    MockResizeObserver.instances[0]!.triggerResize(1024, 768);

    expect(mockSelect).toHaveBeenCalledWith(refs.svgRef.current);
    const keys = attrMock.mock.calls.map((args) => args[0] as string);
    expect(keys).toContain("width");
    expect(keys).toContain("height");
  });

  it("on resize: calls fitToView(250)", () => {
    const refs = makeRefs();
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    MockResizeObserver.instances[0]!.triggerResize(800, 600);

    expect(fitToView).toHaveBeenCalledWith(250);
  });

  it("calls fitToView on every subsequent resize event", () => {
    const refs = makeRefs();
    const fitToView = vi.fn();
    renderHook(() => useResizeEffect(refs, fitToView));

    MockResizeObserver.instances[0]!.triggerResize(800, 600);
    MockResizeObserver.instances[0]!.triggerResize(900, 700);

    expect(fitToView).toHaveBeenCalledTimes(2);
  });

  it("disconnects the ResizeObserver on unmount (cleanup)", () => {
    const refs = makeRefs();
    const fitToView = vi.fn();
    const { unmount } = renderHook(() => useResizeEffect(refs, fitToView));

    unmount();

    expect(MockResizeObserver.instances[0]!.disconnect).toHaveBeenCalled();
  });
});
