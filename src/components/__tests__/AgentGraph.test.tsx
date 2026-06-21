import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentGraph } from "../AgentGraph";
import type { AgentGraphHandle } from "../AgentGraph";
import { mockAgent, resetStore } from "@/lib/__tests__/test-utils";
import type { AgentState } from "@/lib/types";

// Mock ResizeObserver which jsdom does not support
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

describe("AgentGraph", () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      graphLayout: "force" as const,
    });
  });

  it("renders an SVG container", () => {
    const { container } = render(<AgentGraph />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders a wrapping div with the correct class", () => {
    const { container } = render(<AgentGraph />);
    const wrapper = container.querySelector(".flex-1.h-full");
    expect(wrapper).not.toBeNull();
  });

  it("renders without crashing when no agents exist", () => {
    const { container } = render(<AgentGraph />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders without crashing when agents are in the store", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent({ id: "a1", agentType: "build", status: "running" }),
    );
    agents.set(
      "a2",
      mockAgent({
        id: "a2",
        agentType: "test",
        status: "completed",
        parentId: "a1",
      }),
    );

    useAgentStore.setState({ agents });
    const { container } = render(<AgentGraph />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("accepts a forwarded ref", () => {
    const ref = { current: null } as React.RefObject<AgentGraphHandle | null>;
    render(<AgentGraph ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current!.fitToView).toBe("function");
    expect(typeof ref.current!.getNodesAndViewport).toBe("function");
  });
});
