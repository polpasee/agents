import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useFilteredAgents } from "../useFilteredAgents";
import type { AgentState } from "@/lib/types";

function mockAgent(
  id: string,
  overrides: Partial<AgentState> = {},
): AgentState {
  return {
    id,
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1000000,
    startTime: Date.now(),
    ...overrides,
  };
}

describe("useFilteredAgents", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      selectedSessionId: null,
      hiddenAgentTypes: new Set(),
    });
  });

  it("returns all agents when no session selected and no filters", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1"));
    agents.set("a2", mockAgent("a2", { agentType: "explore" }));
    agents.set("a3", mockAgent("a3", { agentType: "build" }));

    useAgentStore.setState({ agents });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(3);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a2", "a3"]);
  });

  it("filters by selectedSessionId (only agents matching session)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1", { sessionId: "session-1" }));
    agents.set("a2", mockAgent("a2", { sessionId: "session-2" }));
    agents.set("a3", mockAgent("a3", { sessionId: "session-1" }));

    useAgentStore.setState({ agents, selectedSessionId: "session-1" });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a3"]);
  });

  it("filters by hiddenAgentTypes (hides agents of specified types)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent("a1", { agentType: "main" }));
    agents.set("a2", mockAgent("a2", { agentType: "explore" }));
    agents.set("a3", mockAgent("a3", { agentType: "build" }));

    useAgentStore.setState({
      agents,
      hiddenAgentTypes: new Set(["explore"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a3"]);
  });

  it("applies combined session + type filter together", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "a1",
      mockAgent("a1", { sessionId: "session-1", agentType: "main" }),
    );
    agents.set(
      "a2",
      mockAgent("a2", { sessionId: "session-1", agentType: "explore" }),
    );
    agents.set(
      "a3",
      mockAgent("a3", { sessionId: "session-2", agentType: "main" }),
    );
    agents.set(
      "a4",
      mockAgent("a4", { sessionId: "session-2", agentType: "explore" }),
    );

    useAgentStore.setState({
      agents,
      selectedSessionId: "session-1",
      hiddenAgentTypes: new Set(["explore"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("a1");
  });

  it("returns empty array when no agents", () => {
    useAgentStore.setState({ agents: new Map() });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(0);
    expect(result.current).toEqual([]);
  });

  it("session filter includes agents whose parentId matches a main agent in the session", () => {
    const agents = new Map<string, AgentState>();
    // Main agent in session-1
    agents.set(
      "main-1",
      mockAgent("main-1", { sessionId: "session-1", agentType: "main" }),
    );
    // Sub-agent whose parentId is the main agent in session-1
    agents.set(
      "sub-1",
      mockAgent("sub-1", {
        parentId: "main-1",
        agentType: "explore",
      }),
    );
    // Main agent in session-2
    agents.set(
      "main-2",
      mockAgent("main-2", { sessionId: "session-2", agentType: "main" }),
    );
    // Sub-agent whose parentId is the main agent in session-2
    agents.set(
      "sub-2",
      mockAgent("sub-2", {
        parentId: "main-2",
        agentType: "build",
      }),
    );

    useAgentStore.setState({ agents, selectedSessionId: "session-1" });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["main-1", "sub-1"]);
  });
});
