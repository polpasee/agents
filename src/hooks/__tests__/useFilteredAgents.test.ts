import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useFilteredAgents } from "../useFilteredAgents";
import type { AgentState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("useFilteredAgents", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
    });
  });

  it("returns all agents when no session selected and no filters", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1" }));
    agents.set("a2", mockAgent({ id: "a2", agentType: "explore" }));
    agents.set("a3", mockAgent({ id: "a3", agentType: "build" }));

    useAgentStore.setState({ agents });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(3);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a2", "a3"]);
  });

  it("filters by selectedSessionIds (F5: multi-session)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", sessionId: "session-1" }));
    agents.set("a2", mockAgent({ id: "a2", sessionId: "session-2" }));
    agents.set("a3", mockAgent({ id: "a3", sessionId: "session-1" }));

    useAgentStore.setState({
      agents,
      selectedSessionIds: new Set(["session-1"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a3"]);
  });

  it("filters by multiple selected sessions", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", sessionId: "s1" }));
    agents.set("a2", mockAgent({ id: "a2", sessionId: "s2" }));
    agents.set("a3", mockAgent({ id: "a3", sessionId: "s3" }));

    useAgentStore.setState({
      agents,
      selectedSessionIds: new Set(["s1", "s3"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a3"]);
  });

  it("filters by hiddenAgentTypes (hides agents of specified types)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", agentType: "main" }));
    agents.set("a2", mockAgent({ id: "a2", agentType: "explore" }));
    agents.set("a3", mockAgent({ id: "a3", agentType: "build" }));

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
      mockAgent({ id: "a1", sessionId: "session-1", agentType: "main" }),
    );
    agents.set(
      "a2",
      mockAgent({ id: "a2", sessionId: "session-1", agentType: "explore" }),
    );
    agents.set(
      "a3",
      mockAgent({ id: "a3", sessionId: "session-2", agentType: "main" }),
    );
    agents.set(
      "a4",
      mockAgent({ id: "a4", sessionId: "session-2", agentType: "explore" }),
    );

    useAgentStore.setState({
      agents,
      selectedSessionIds: new Set(["session-1"]),
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

  it("keeps idle main-session agents regardless of how long they've been idle", () => {
    const agents = new Map<string, AgentState>();
    const ancient = Date.now() - 10 * 60 * 1000;
    agents.set(
      "main-idle",
      mockAgent({
        id: "main-idle",
        status: "idle",
        startTime: ancient,
        toolCalls: [],
      }),
    );
    useAgentStore.setState({ agents });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("main-idle");
  });

  it("keeps idle sub-agents — server is the single source of truth for staleness", () => {
    const agents = new Map<string, AgentState>();
    const ancient = Date.now() - 10 * 60 * 1000;
    agents.set("main-1", mockAgent({ id: "main-1" }));
    agents.set(
      "sub-running-long",
      mockAgent({
        id: "sub-running-long",
        parentId: "main-1",
        status: "idle",
        startTime: ancient,
        toolCalls: [],
      }),
    );
    useAgentStore.setState({ agents });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["main-1", "sub-running-long"]);
  });

  it("session filter includes agents whose parentId matches a main agent in the session", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "main-1",
      mockAgent({ id: "main-1", sessionId: "session-1", agentType: "main" }),
    );
    agents.set(
      "sub-1",
      mockAgent({
        id: "sub-1",
        parentId: "main-1",
        agentType: "explore",
      }),
    );
    agents.set(
      "main-2",
      mockAgent({ id: "main-2", sessionId: "session-2", agentType: "main" }),
    );
    agents.set(
      "sub-2",
      mockAgent({
        id: "sub-2",
        parentId: "main-2",
        agentType: "build",
      }),
    );

    useAgentStore.setState({
      agents,
      selectedSessionIds: new Set(["session-1"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    expect(result.current).toHaveLength(2);
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["main-1", "sub-1"]);
  });

  it("restores a dropped parent for a surviving sub-agent (single level)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("parent", mockAgent({ id: "parent", agentType: "explore" }));
    agents.set(
      "child",
      mockAgent({ id: "child", parentId: "parent", agentType: "build" }),
    );

    useAgentStore.setState({ agents, hiddenAgentTypes: new Set(["explore"]) });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["child", "parent"]);
  });

  it("restores hidden intermediate and root in a depth-3 chain", () => {
    const agents = new Map<string, AgentState>();
    agents.set("root", mockAgent({ id: "root", agentType: "main" }));
    agents.set(
      "mid",
      mockAgent({ id: "mid", parentId: "root", agentType: "explore" }),
    );
    agents.set(
      "leaf",
      mockAgent({ id: "leaf", parentId: "mid", agentType: "build" }),
    );

    useAgentStore.setState({ agents, hiddenAgentTypes: new Set(["explore"]) });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    // mid is hidden but leaf survived — both mid and root must be present
    expect(ids).toEqual(["leaf", "mid", "root"]);
  });

  it("restores every hidden intermediate in a depth-5 chain", () => {
    const agents = new Map<string, AgentState>();
    agents.set("root", mockAgent({ id: "root", agentType: "main" }));
    agents.set(
      "d1",
      mockAgent({ id: "d1", parentId: "root", agentType: "explore" }),
    );
    agents.set(
      "d2",
      mockAgent({ id: "d2", parentId: "d1", agentType: "plan" }),
    );
    agents.set(
      "d3",
      mockAgent({ id: "d3", parentId: "d2", agentType: "explore" }),
    );
    agents.set(
      "d4",
      mockAgent({ id: "d4", parentId: "d3", agentType: "build" }),
    );

    useAgentStore.setState({
      agents,
      hiddenAgentTypes: new Set(["explore", "plan"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["d1", "d2", "d3", "d4", "root"]);
  });

  it("does not hang on a parentId cycle (a -> b -> a)", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a", mockAgent({ id: "a", parentId: "b", agentType: "build" }));
    agents.set(
      "b",
      mockAgent({ id: "b", parentId: "a", agentType: "explore" }),
    );

    useAgentStore.setState({ agents, hiddenAgentTypes: new Set(["explore"]) });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("canonical walk: grandchild is resolved to root's sessionId (multi-level hierarchy)", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "root",
      mockAgent({ id: "root", sessionId: "session-root", agentType: "main" }),
    );
    agents.set(
      "mid",
      mockAgent({ id: "mid", parentId: "root", agentType: "build" }),
    );
    agents.set(
      "leaf",
      mockAgent({ id: "leaf", parentId: "mid", agentType: "explore" }),
    );
    agents.set(
      "other-root",
      mockAgent({
        id: "other-root",
        sessionId: "session-other",
        agentType: "main",
      }),
    );

    useAgentStore.setState({
      agents,
      selectedSessionIds: new Set(["session-root"]),
    });

    const { result } = renderHook(() => useFilteredAgents());
    const ids = result.current.map((a) => a.id).sort();
    // root, mid, leaf all resolve to session-root; other-root is excluded
    expect(ids).toEqual(["leaf", "mid", "root"]);
  });
});
