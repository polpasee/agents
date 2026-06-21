/**
 * MiniMap — canvas DRAW LOOP tests (lines ~23-74)
 *
 * Strategy:
 * - Stub requestAnimationFrame to call the draw callback exactly once.
 * - Stub HTMLCanvasElement.getContext('2d') to return a spy context object.
 * - Provide a graphRef with getNodesAndViewport() returning node + viewport data.
 * - Assert canvas 2D API calls: clearRect, arc (fill), strokeRect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniMap } from "../MiniMap";
import type { AgentGraphHandle } from "../AgentGraph";
import React from "react";

// ── Canvas 2D context spy ─────────────────────────────────────────────────────

function makeCtxSpy() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    // properties that the draw loop assigns
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGraphRef(value: AgentGraphHandle | null = null) {
  return { current: value } as React.RefObject<AgentGraphHandle | null>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MiniMap — canvas draw loop", () => {
  let ctxSpy: ReturnType<typeof makeCtxSpy>;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalRAF: typeof window.requestAnimationFrame;
  let originalCAF: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    ctxSpy = makeCtxSpy();

    // Stub getContext to return our spy for "2d"
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId === "2d")
        return ctxSpy as unknown as CanvasRenderingContext2D;
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext;

    // Stub RAF: invoke callback once synchronously for the FIRST call only;
    // subsequent calls (from within draw()) return without invoking — this
    // prevents infinite recursion since draw() always calls RAF at the end.
    originalRAF = window.requestAnimationFrame;
    let rafCallCount = 0;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      if (rafCallCount === 0) {
        rafCallCount++;
        cb(0);
      }
      return 1;
    });

    originalCAF = window.cancelAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
    vi.clearAllMocks();
  });

  it("calls clearRect on every draw frame", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    expect(ctxSpy.clearRect).toHaveBeenCalledWith(0, 0, 160, 100);
  });

  it("calls arc() for each node when nodes are present", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [
            { x: 100, y: 200, color: "#ff0000" },
            { x: 300, y: 400, color: "#00ff00" },
          ],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    // One arc call per node
    expect(ctxSpy.arc).toHaveBeenCalledTimes(2);
    // Each arc call uses radius=3 and full circle (0 to 2π)
    for (const call of ctxSpy.arc.mock.calls) {
      expect(call[2]).toBe(3); // radius
      expect(call[3]).toBe(0); // startAngle
      expect(call[4]).toBeCloseTo(Math.PI * 2); // endAngle
    }
  });

  it("sets fillStyle to the node color before calling fill()", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [{ x: 50, y: 50, color: "#cafeba" }],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    // fillStyle is set to node.color just before fill()
    expect(ctxSpy.fill).toHaveBeenCalled();
    expect(ctxSpy.fillStyle).toBe("#cafeba");
  });

  it("calls strokeRect for the viewport indicator when nodes are present", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [{ x: 100, y: 100, color: "#fff" }],
          viewport: { x: 50, y: 50, width: 400, height: 300 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    expect(ctxSpy.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("does NOT call arc when getNodesAndViewport returns empty nodes", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    expect(ctxSpy.arc).not.toHaveBeenCalled();
    expect(ctxSpy.strokeRect).not.toHaveBeenCalled();
  });

  it("does NOT call arc when graphRef.current is null", () => {
    render(<MiniMap graphRef={makeGraphRef(null)} />);
    expect(ctxSpy.arc).not.toHaveBeenCalled();
  });

  it("does NOT call arc when getNodesAndViewport returns null", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return null as unknown as ReturnType<
          AgentGraphHandle["getNodesAndViewport"]
        >;
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    expect(ctxSpy.arc).not.toHaveBeenCalled();
  });

  it("cancels the animation frame on unmount", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    const { unmount } = render(<MiniMap graphRef={makeGraphRef(handle)} />);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("renders the canvas element with the correct aria label", () => {
    render(<MiniMap graphRef={makeGraphRef(null)} />);
    expect(screen.getByLabelText("Agent graph minimap")).toBeDefined();
  });

  it("handles single-node case (rangeX/rangeY = 1 guard)", () => {
    // When all nodes share same x/y, rangeX==rangeY==0 — guard in production uses || 1
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [{ x: 50, y: 50, color: "#abc" }],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    // Should not throw and still call arc once
    expect(() =>
      render(<MiniMap graphRef={makeGraphRef(handle)} />),
    ).not.toThrow();
    expect(ctxSpy.arc).toHaveBeenCalledTimes(1);
  });
});
