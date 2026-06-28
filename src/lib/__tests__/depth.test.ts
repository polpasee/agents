import { describe, it, expect } from "vitest";
import { agentDepth, depthFactor, rootAgentId } from "../d3/depth";
import { GRAPH } from "../config";
import type { AgentState } from "../types";

function makeAgent(id: string, parentId?: string): AgentState {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    agentType: "main",
    status: "running",
    task: "",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: 0,
  };
}

function makeMap(...agents: AgentState[]): Map<string, AgentState> {
  return new Map(agents.map((a) => [a.id, a]));
}

describe("agentDepth", () => {
  it("returns 0 for an agent without parentId", () => {
    const agents = makeMap(makeAgent("root"));
    expect(agentDepth("root", agents)).toBe(0);
  });

  it("returns 0 for an unknown agent id", () => {
    expect(agentDepth("ghost", makeMap())).toBe(0);
  });

  it("returns 1 for a direct child of a root", () => {
    const agents = makeMap(makeAgent("root"), makeAgent("child", "root"));
    expect(agentDepth("child", agents)).toBe(1);
  });

  it("walks a parent chain to the correct depth", () => {
    const agents = makeMap(
      makeAgent("a0"),
      makeAgent("a1", "a0"),
      makeAgent("a2", "a1"),
      makeAgent("a3", "a2"),
      makeAgent("a4", "a3"),
      makeAgent("a5", "a4"),
    );
    expect(agentDepth("a3", agents)).toBe(3);
    expect(agentDepth("a5", agents)).toBe(5);
  });

  it("treats a missing parent as depth 1", () => {
    const agents = makeMap(makeAgent("orphan", "gone"));
    expect(agentDepth("orphan", agents)).toBe(1);
  });

  it("terminates on a self-parent cycle", () => {
    const agents = makeMap(makeAgent("a", "a"));
    expect(agentDepth("a", agents)).toBe(0);
  });

  it("terminates on a two-node cycle", () => {
    const agents = makeMap(makeAgent("a", "b"), makeAgent("b", "a"));
    expect(agentDepth("a", agents)).toBe(1);
  });

  it("caps runaway chains at 10", () => {
    const agents = makeMap(
      makeAgent("n0"),
      ...Array.from({ length: 15 }, (_, i) => makeAgent(`n${i + 1}`, `n${i}`)),
    );
    expect(agentDepth("n15", agents)).toBe(10);
  });
});

describe("depthFactor", () => {
  it("returns exactly 1 for depth 0 and 1", () => {
    expect(depthFactor(0)).toBe(1);
    expect(depthFactor(1)).toBe(1);
  });

  it("returns exactly 1 when depth is omitted or undefined", () => {
    expect(depthFactor()).toBe(1);
    expect(depthFactor(undefined)).toBe(1);
  });

  it("decreases monotonically with depth until the floor", () => {
    expect(depthFactor(2)).toBeLessThan(depthFactor(1));
    expect(depthFactor(3)).toBeLessThan(depthFactor(2));
    expect(depthFactor(4)).toBeLessThan(depthFactor(3));
  });

  it("clamps at depthScaleMin for deep nesting", () => {
    expect(depthFactor(5)).toBe(GRAPH.depthScaleMin);
    expect(depthFactor(10)).toBe(GRAPH.depthScaleMin);
  });

  it("keeps depth-1 link distance and radius at the exact pre-change values", () => {
    // These are the formulas used at the call sites; depth 1 must be a no-op.
    expect(GRAPH.subAgentLinkDistance * depthFactor(1)).toBe(160);
    expect(GRAPH.subAgentNodeRadius * depthFactor(1)).toBe(28);
  });
});

describe("rootAgentId", () => {
  it("returns the agent's own id for a root agent", () => {
    const agents = makeMap(makeAgent("root"));
    expect(rootAgentId("root", agents)).toBe("root");
  });

  it("returns the id itself for an unknown agent", () => {
    expect(rootAgentId("ghost", makeMap())).toBe("ghost");
  });

  it("returns the root for a direct child", () => {
    const agents = makeMap(makeAgent("root"), makeAgent("child", "root"));
    expect(rootAgentId("child", agents)).toBe("root");
  });

  it("walks a multi-level chain up to the root", () => {
    const agents = makeMap(
      makeAgent("a0"),
      makeAgent("a1", "a0"),
      makeAgent("a2", "a1"),
      makeAgent("a3", "a2"),
    );
    expect(rootAgentId("a3", agents)).toBe("a0");
    expect(rootAgentId("a2", agents)).toBe("a0");
  });

  it("groups every member of a family under the same root", () => {
    const agents = makeMap(
      makeAgent("main"),
      makeAgent("subA", "main"),
      makeAgent("subB", "main"),
      makeAgent("leaf", "subA"),
    );
    const root = rootAgentId("main", agents);
    expect(rootAgentId("subA", agents)).toBe(root);
    expect(rootAgentId("subB", agents)).toBe(root);
    expect(rootAgentId("leaf", agents)).toBe(root);
  });

  it("returns the furthest known ancestor when the parent is unknown", () => {
    const agents = makeMap(makeAgent("orphan", "gone"));
    expect(rootAgentId("orphan", agents)).toBe("gone");
  });

  it("terminates on a self-parent cycle", () => {
    const agents = makeMap(makeAgent("a", "a"));
    expect(rootAgentId("a", agents)).toBe("a");
  });

  it("terminates on a two-node cycle", () => {
    const agents = makeMap(makeAgent("a", "b"), makeAgent("b", "a"));
    expect(rootAgentId("a", agents)).toBe("b");
  });
});
