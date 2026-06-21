import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../store";
import type { AgentEvent, AgentState } from "../../types";

beforeEach(() => {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    nextActivityId: 0,
    topologyVersion: 0,
    errorDetails: new Map(),
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    connected: false,
    hiddenAgentTypes: new Set(),
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
    teams: new Map(),
  });
});

function registerAgent(
  agentId: string,
  options: { parentId?: string; agentType?: AgentState["agentType"] } = {},
) {
  const event: AgentEvent = {
    type: "agent:register",
    agentId,
    agentType: options.agentType ?? "build",
    task: `task-${agentId}`,
    parentId: options.parentId,
  };
  useAgentStore.getState().handleEvent(event, Date.now());
}

describe("lazy-clone in handleEvent", () => {
  it("does NOT change agents Map identity for agent:tokens on an unknown agent", () => {
    const before = useAgentStore.getState().agents;
    useAgentStore.getState().handleEvent(
      {
        type: "agent:tokens",
        agentId: "nonexistent",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      },
      Date.now(),
    );
    expect(useAgentStore.getState().agents).toBe(before); // same reference
  });

  it("does NOT change agents Map identity for agent:message (only mutates edges)", () => {
    registerAgent("a");
    registerAgent("b");
    const before = useAgentStore.getState().agents;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "hi" },
        Date.now(),
      );
    expect(useAgentStore.getState().agents).toBe(before);
  });

  it("does NOT change agents Map identity on a duplicate agent:message (no new edge)", () => {
    registerAgent("a");
    registerAgent("b");
    // First message — adds an edge.
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "hi" },
        Date.now(),
      );
    const beforeAgents = useAgentStore.getState().agents;
    const beforeEdges = useAgentStore.getState().edges;
    // Second message between same pair — dedup path, edges Map should also be stable.
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "again" },
        Date.now(),
      );
    expect(useAgentStore.getState().agents).toBe(beforeAgents);
    expect(useAgentStore.getState().edges).toBe(beforeEdges);
  });

  it("DOES change agents Map identity on agent:register", () => {
    const before = useAgentStore.getState().agents;
    registerAgent("new");
    expect(useAgentStore.getState().agents).not.toBe(before);
  });

  it("DOES change agents Map identity on agent:tokens for an existing agent", () => {
    registerAgent("a");
    const before = useAgentStore.getState().agents;
    useAgentStore.getState().handleEvent(
      {
        type: "agent:tokens",
        agentId: "a",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      },
      Date.now(),
    );
    expect(useAgentStore.getState().agents).not.toBe(before);
  });
});

describe("topologyVersion counter", () => {
  it("starts at 0", () => {
    expect(useAgentStore.getState().topologyVersion).toBe(0);
  });

  it("increments on agent:register (new agent)", () => {
    const before = useAgentStore.getState().topologyVersion;
    registerAgent("a");
    expect(useAgentStore.getState().topologyVersion).toBe(before + 1);
  });

  it("does NOT increment on agent:register for a metadata-refresh of an existing agent", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    // Re-register same agentId (metadata refresh) — same parent, same team.
    registerAgent("a");
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("does NOT increment on agent:tokens for an existing agent", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore.getState().handleEvent(
      {
        type: "agent:tokens",
        agentId: "a",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      },
      Date.now(),
    );
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("does NOT increment on agent:tool_call (status changes don't affect graph shape)", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:tool_call", agentId: "a", tool: "Read", args: "{}" },
        Date.now(),
      );
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("does NOT increment on agent:status when no blocking edge changes", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:status", agentId: "a", status: "idle" },
        Date.now(),
      );
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("DOES increment on agent:status when a blocking edge is added", () => {
    registerAgent("a");
    registerAgent("b");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore.getState().handleEvent(
      {
        type: "agent:status",
        agentId: "a",
        status: "waiting",
        waitingOn: "b",
      },
      Date.now(),
    );
    expect(useAgentStore.getState().topologyVersion).toBe(before + 1);
  });

  it("DOES increment on agent:message that adds a new edge", () => {
    registerAgent("a");
    registerAgent("b");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "hi" },
        Date.now(),
      );
    expect(useAgentStore.getState().topologyVersion).toBe(before + 1);
  });

  it("does NOT increment on a duplicate agent:message", () => {
    registerAgent("a");
    registerAgent("b");
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "hi" },
        Date.now(),
      );
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:message", fromId: "a", toId: "b", content: "again" },
        Date.now(),
      );
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("does NOT increment on agent:complete when no blocking edge was attached", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:complete", agentId: "a", duration: 1000 },
        Date.now(),
      );
    // Pure status transition with no blocking edge to clean up — no shape change.
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });

  it("DOES increment on agent:complete that clears a blocking edge", () => {
    registerAgent("a");
    registerAgent("b");
    // Put `a` in waiting state with a blocking edge from `b`.
    useAgentStore.getState().handleEvent(
      {
        type: "agent:status",
        agentId: "a",
        status: "waiting",
        waitingOn: "b",
      },
      Date.now(),
    );
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:complete", agentId: "a", duration: 1000 },
        Date.now(),
      );
    expect(useAgentStore.getState().topologyVersion).toBe(before + 1);
  });

  it("increments when an agent is removed", () => {
    registerAgent("a");
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore.getState().removeAgent("a");
    expect(useAgentStore.getState().topologyVersion).toBe(before + 1);
  });
});
