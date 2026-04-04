import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniMap } from "../MiniMap";
import { resetStore } from "@/lib/__tests__/test-utils";
import React from "react";
import type { AgentGraphHandle } from "../AgentGraph";

describe("MiniMap", () => {
  beforeEach(() => {
    resetStore();
  });

  function makeGraphRef(value: AgentGraphHandle | null = null) {
    return { current: value } as React.RefObject<AgentGraphHandle | null>;
  }

  it("renders a canvas element", () => {
    render(<MiniMap graphRef={makeGraphRef()} />);
    const canvas = screen.getByRole("img");
    expect(canvas).toBeDefined();
    expect(canvas.tagName).toBe("CANVAS");
  });

  it("has the correct ARIA label", () => {
    render(<MiniMap graphRef={makeGraphRef()} />);
    expect(screen.getByLabelText("Agent graph minimap")).toBeDefined();
  });

  it("renders with the correct dimensions", () => {
    render(<MiniMap graphRef={makeGraphRef()} />);
    const canvas = screen.getByRole("img") as HTMLCanvasElement;
    expect(canvas.width).toBe(160);
    expect(canvas.height).toBe(100);
  });

  it("renders without crashing when graphRef has a handle", () => {
    const handle: AgentGraphHandle = {
      fitToView() {},
      getNodesAndViewport() {
        return {
          nodes: [{ x: 10, y: 20, color: "#ff0000" }],
          viewport: { x: 0, y: 0, width: 800, height: 600 },
        };
      },
    };
    render(<MiniMap graphRef={makeGraphRef(handle)} />);
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("renders without crashing when graphRef.current is null", () => {
    render(<MiniMap graphRef={makeGraphRef(null)} />);
    expect(screen.getByRole("img")).toBeDefined();
  });
});
