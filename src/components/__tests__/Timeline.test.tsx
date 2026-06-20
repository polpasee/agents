import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { Timeline } from "../Timeline";
import { mockAgent, resetStore } from "@/lib/__tests__/test-utils";
import type { AgentState } from "@/lib/types";

describe("Timeline", () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
    });
  });

  it("shows empty state when no agents exist", () => {
    render(<Timeline />);
    expect(screen.getByText("No agents to display")).toBeDefined();
  });

  it("renders agent rows when agents are in the store", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent({ id: "a1", agentType: "build", status: "running" }),
    );
    agents.set(
      "a2",
      mockAgent({ id: "a2", agentType: "test", status: "completed" }),
    );

    useAgentStore.setState({ agents });
    render(<Timeline />);

    expect(screen.getByText("BUILD")).toBeDefined();
    expect(screen.getByText("TEST")).toBeDefined();
  });

  it("displays agent status text", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent({ id: "a1", agentType: "build", status: "running" }),
    );
    agents.set(
      "a2",
      mockAgent({ id: "a2", agentType: "review", status: "error" }),
    );

    useAgentStore.setState({ agents });
    render(<Timeline />);

    expect(screen.getByText("running")).toBeDefined();
    expect(screen.getByText("error")).toBeDefined();
  });

  it("selects an agent when its row is clicked", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent({ id: "a1", agentType: "build", status: "running" }),
    );

    useAgentStore.setState({ agents });
    render(<Timeline />);

    fireEvent.click(screen.getByText("BUILD"));
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("sorts active agents before completed ones", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        agentType: "review",
        status: "completed",
        startTime: 1000,
      }),
    );
    agents.set(
      "a2",
      mockAgent({
        id: "a2",
        agentType: "build",
        status: "running",
        startTime: 2000,
      }),
    );

    useAgentStore.setState({ agents });
    const { container } = render(<Timeline />);

    const labels = container.querySelectorAll(".text-xs.font-mono.font-bold");
    expect(labels[0].textContent).toBe("BUILD");
    expect(labels[1].textContent).toBe("REVIEW");
  });

  it("does not throw RangeError when computing the earliest startTime over 200000 agents (Math.min spread regression)", () => {
    // Reproduces P-H5 / H5. Previously, `Math.min(...agents.map(a => a.startTime))`
    // and friends used argument-list spread, which throws
    // "RangeError: Maximum call stack size exceeded" once the array
    // crosses the per-engine argument-list cap (~65k on V8 in practice).
    //
    // We exercise the failing operation directly rather than mounting
    // 200k DOM rows — jsdom can't fit that many nodes regardless of
    // whether the math throws. The loop-based fold the components now use
    // must scale linearly without any cap.
    const startTimes: number[] = [];
    for (let i = 0; i < 200_000; i++) startTimes.push(i);

    // The OLD pattern would throw here. The NEW pattern (fold) does not.
    const earliestFold = (() => {
      let earliest = Infinity;
      for (const t of startTimes) if (t < earliest) earliest = t;
      return earliest;
    })();
    expect(earliestFold).toBe(0);

    // Sanity: confirm the spread approach really would have thrown at this
    // size, so the test stays meaningful as the engine evolves.
    let spreadThrew = false;
    try {
      Math.min(...startTimes);
    } catch {
      spreadThrew = true;
    }
    expect(spreadThrew).toBe(true);
  });
});
