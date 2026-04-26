import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";
import type { AgentEvent, AgentState, EdgeState } from "../types";
import { ACTIVITY_MAX_ENTRIES, TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW } from "../config";

beforeEach(() => {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    connected: false,
    hiddenAgentTypes: new Set(),
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
  });
});

// Helper to register an agent via handleEvent
function registerAgent(
  agentId: string,
  options: {
    parentId?: string;
    agentType?: AgentState["agentType"];
    task?: string;
    sessionId?: string;
    slug?: string;
    model?: string;
    metadata?: Record<string, unknown>;
  } = {}
) {
  const event: AgentEvent = {
    type: "agent:register",
    agentId,
    agentType: options.agentType ?? "main",
    task: options.task ?? "test task",
    parentId: options.parentId,
    sessionId: options.sessionId,
    slug: options.slug,
    model: options.model,
    metadata: options.metadata,
  };
  useAgentStore.getState().handleEvent(event, Date.now());
}

describe("syncState", () => {
  it("sets agents map and edges from arrays", () => {
    const agents: AgentState[] = [
      {
        id: "a1",
        agentType: "main",
        status: "running",
        task: "do stuff",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        startTime: 1000,
      },
      {
        id: "a2",
        parentId: "a1",
        agentType: "build",
        status: "waiting",
        task: "build stuff",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        startTime: 2000,
      },
    ];
    const edges: EdgeState[] = [{ source: "a1", target: "a2" }];

    useAgentStore.getState().syncState(agents, edges, []);
    const state = useAgentStore.getState();

    expect(state.agents.size).toBe(2);
    expect(state.agents.get("a1")?.task).toBe("do stuff");
    expect(state.agents.get("a2")?.agentType).toBe("build");
    expect(state.edges).toEqual(edges);
  });

  it("replaces previous agents and edges", () => {
    const first: AgentState[] = [
      {
        id: "old",
        agentType: "main",
        status: "running",
        task: "old task",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        startTime: 0,
      },
    ];
    useAgentStore.getState().syncState(first, [], []);
    expect(useAgentStore.getState().agents.has("old")).toBe(true);

    const second: AgentState[] = [
      {
        id: "new",
        agentType: "explore",
        status: "idle",
        task: "new task",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        startTime: 0,
      },
    ];
    useAgentStore.getState().syncState(second, [], []);
    const state = useAgentStore.getState();
    expect(state.agents.has("old")).toBe(false);
    expect(state.agents.has("new")).toBe(true);
  });
});

describe("handleEvent: agent:register", () => {
  it("creates an agent with correct fields", () => {
    const ts = 1700000000;
    const event: AgentEvent = {
      type: "agent:register",
      agentId: "agent-1",
      agentType: "explore",
      task: "explore the codebase",
      sessionId: "session-1",
      slug: "explore-1",
      model: "claude-opus",
      metadata: { foo: "bar" },
    };

    useAgentStore.getState().handleEvent(event, ts);
    const agent = useAgentStore.getState().agents.get("agent-1");

    expect(agent).toBeDefined();
    expect(agent!.id).toBe("agent-1");
    expect(agent!.agentType).toBe("explore");
    expect(agent!.status).toBe("running");
    expect(agent!.task).toBe("explore the codebase");
    expect(agent!.sessionId).toBe("session-1");
    expect(agent!.slug).toBe("explore-1");
    expect(agent!.model).toBe("claude-opus");
    expect(agent!.toolCalls).toEqual([]);
    expect(agent!.inputTokens).toBe(0);
    expect(agent!.outputTokens).toBe(0);
    expect(agent!.startTime).toBe(ts);
    expect(agent!.metadata).toEqual({ foo: "bar" });
    expect(agent!.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("adds an edge when parentId is provided", () => {
    registerAgent("parent-1");
    registerAgent("child-1", { parentId: "parent-1" });

    const state = useAgentStore.getState();
    expect(state.edges).toContainEqual({
      source: "parent-1",
      target: "child-1",
    });
  });

  it("does not add an edge when parentId is undefined", () => {
    registerAgent("solo-1");
    expect(useAgentStore.getState().edges).toHaveLength(0);
  });

  it("treats re-register on an existing agent as a metadata refresh", () => {
    registerAgent("a1", { agentType: "main", task: "original", model: "" });
    const before = useAgentStore.getState().agents.get("a1")!;

    // Simulate accumulated runtime state
    useAgentStore.getState().handleEvent(
      { type: "agent:tool_call", agentId: "a1", tool: "Bash" },
      Date.now(),
    );
    expect(useAgentStore.getState().agents.get("a1")!.toolCalls).toHaveLength(1);

    // Re-register with the model now known — must not wipe toolCalls
    registerAgent("a1", { agentType: "main", task: "original", model: "claude-opus-4" });

    const after = useAgentStore.getState().agents.get("a1")!;
    expect(after.model).toBe("claude-opus-4");
    expect(after.toolCalls).toHaveLength(1);
    expect(after.startTime).toBe(before.startTime);
  });

  it("replaces an already-set model when the user switches mid-session", () => {
    registerAgent("a1", { agentType: "main", model: "claude-sonnet-4-6" });
    useAgentStore.getState().handleEvent(
      { type: "agent:tool_call", agentId: "a1", tool: "Bash" },
      Date.now(),
    );
    registerAgent("a1", { agentType: "main", model: "claude-opus-4-7" });

    const after = useAgentStore.getState().agents.get("a1")!;
    expect(after.model).toBe("claude-opus-4-7");
    expect(after.toolCalls).toHaveLength(1);
  });

  it("does not duplicate edges when a child is re-registered", () => {
    registerAgent("parent-1");
    registerAgent("child-1", { parentId: "parent-1" });
    registerAgent("child-1", { parentId: "parent-1", model: "claude-opus-4" });

    const edges = useAgentStore.getState().edges.filter(
      (e) => e.source === "parent-1" && e.target === "child-1",
    );
    expect(edges).toHaveLength(1);
  });

  it("fills in metadata on re-register when the first register carried none", () => {
    // Simulates the live broadcast → reconnect sync pattern: first event has
    // no metadata, later syncs carry it. projectName must appear in the end.
    registerAgent("a1", { agentType: "main" });
    expect(useAgentStore.getState().agents.get("a1")!.metadata).toBeUndefined();

    registerAgent("a1", {
      agentType: "main",
      metadata: { projectName: "Users/erdos/Github/ipportal2" },
    });
    expect(useAgentStore.getState().agents.get("a1")!.metadata?.projectName)
      .toBe("Users/erdos/Github/ipportal2");
  });
});

describe("handleEvent: agent:status", () => {
  it("updates the agent status", () => {
    registerAgent("a1");
    expect(useAgentStore.getState().agents.get("a1")!.status).toBe("running");

    const event: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "waiting",
    };
    useAgentStore.getState().handleEvent(event, Date.now());

    expect(useAgentStore.getState().agents.get("a1")!.status).toBe("waiting");
  });

  it("does nothing for unknown agent", () => {
    const event: AgentEvent = {
      type: "agent:status",
      agentId: "nonexistent",
      status: "error",
    };
    useAgentStore.getState().handleEvent(event, Date.now());
    expect(useAgentStore.getState().agents.size).toBe(0);
  });
});

describe("handleEvent: agent:tool_call", () => {
  it("appends a tool call to the agent", () => {
    registerAgent("a1");

    const event: AgentEvent = {
      type: "agent:tool_call",
      agentId: "a1",
      tool: "readFile",
      args: '{"path":"foo.ts"}',
      result: "file contents",
    };
    const ts = Date.now();
    useAgentStore.getState().handleEvent(event, ts);

    const agent = useAgentStore.getState().agents.get("a1")!;
    expect(agent.toolCalls).toHaveLength(1);
    expect(agent.toolCalls[0].tool).toBe("readFile");
    expect(agent.toolCalls[0].args).toBe('{"path":"foo.ts"}');
    expect(agent.toolCalls[0].result).toBe("file contents");
    expect(agent.toolCalls[0].timestamp).toBe(ts);
  });

  it("caps tool calls at TOOL_CALLS_MAX_PER_AGENT", () => {
    registerAgent("a1");

    for (let i = 0; i < TOOL_CALLS_MAX_PER_AGENT + 10; i++) {
      const event: AgentEvent = {
        type: "agent:tool_call",
        agentId: "a1",
        tool: `tool-${i}`,
      };
      useAgentStore.getState().handleEvent(event, Date.now());
    }

    const agent = useAgentStore.getState().agents.get("a1")!;
    expect(agent.toolCalls).toHaveLength(TOOL_CALLS_MAX_PER_AGENT);
    // The oldest entries should have been dropped; the last tool should be the most recent
    expect(agent.toolCalls[TOOL_CALLS_MAX_PER_AGENT - 1].tool).toBe(
      `tool-${TOOL_CALLS_MAX_PER_AGENT + 9}`
    );
  });
});

describe("handleEvent: agent:tokens", () => {
  it("updates token counts and context window", () => {
    registerAgent("a1");

    const event: AgentEvent = {
      type: "agent:tokens",
      agentId: "a1",
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 100,
      cacheCreateTokens: 50,
      contextWindow: 200_000,
    };
    useAgentStore.getState().handleEvent(event, Date.now());

    const agent = useAgentStore.getState().agents.get("a1")!;
    expect(agent.inputTokens).toBe(500);
    expect(agent.outputTokens).toBe(200);
    expect(agent.cacheReadTokens).toBe(100);
    expect(agent.cacheCreateTokens).toBe(50);
    expect(agent.contextWindow).toBe(200_000);
  });
});

describe("handleEvent: agent:complete", () => {
  it("sets completed status with duration and summary", () => {
    registerAgent("a1");

    const event: AgentEvent = {
      type: "agent:complete",
      agentId: "a1",
      duration: 45000,
      summary: "Finished the task successfully",
    };
    useAgentStore.getState().handleEvent(event, Date.now());

    const agent = useAgentStore.getState().agents.get("a1")!;
    expect(agent.status).toBe("completed");
    expect(agent.duration).toBe(45000);
    expect(agent.summary).toBe("Finished the task successfully");
  });

  it("works without optional summary", () => {
    registerAgent("a1");

    const event: AgentEvent = {
      type: "agent:complete",
      agentId: "a1",
      duration: 1000,
    };
    useAgentStore.getState().handleEvent(event, Date.now());

    const agent = useAgentStore.getState().agents.get("a1")!;
    expect(agent.status).toBe("completed");
    expect(agent.duration).toBe(1000);
    expect(agent.summary).toBeUndefined();
  });
});

describe("handleEvent: agent:message", () => {
  it("adds to activity without modifying agents", () => {
    registerAgent("a1");
    registerAgent("a2");
    const agentsBefore = new Map(useAgentStore.getState().agents);

    const event: AgentEvent = {
      type: "agent:message",
      fromId: "a1",
      toId: "a2",
      content: "Hello from a1",
    };
    useAgentStore.getState().handleEvent(event, Date.now());

    const state = useAgentStore.getState();
    // Agents should be unchanged (same values, new Map reference is ok)
    expect(state.agents.get("a1")).toEqual(agentsBefore.get("a1"));
    expect(state.agents.get("a2")).toEqual(agentsBefore.get("a2"));
    // Activity should have the message event
    expect(state.activity.length).toBeGreaterThan(0);
    const lastActivity = state.activity[state.activity.length - 1];
    expect(lastActivity.event.type).toBe("agent:message");
  });
});

describe("removeAgent", () => {
  it("deletes the agent from the map", () => {
    registerAgent("a1");
    expect(useAgentStore.getState().agents.has("a1")).toBe(true);

    useAgentStore.getState().removeAgent("a1");
    expect(useAgentStore.getState().agents.has("a1")).toBe(false);
  });

  it("removes edges associated with the agent", () => {
    registerAgent("parent");
    registerAgent("child", { parentId: "parent" });
    expect(useAgentStore.getState().edges).toHaveLength(1);

    useAgentStore.getState().removeAgent("child");
    expect(useAgentStore.getState().edges).toHaveLength(0);
  });

  it("removes edges where the agent is the source", () => {
    registerAgent("parent");
    registerAgent("c1", { parentId: "parent" });
    registerAgent("c2", { parentId: "parent" });
    expect(useAgentStore.getState().edges).toHaveLength(2);

    useAgentStore.getState().removeAgent("parent");
    expect(useAgentStore.getState().edges).toHaveLength(0);
  });
});

describe("selectAgent", () => {
  it("sets selectedAgentId", () => {
    useAgentStore.getState().selectAgent("a1");
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("clears selection with null", () => {
    useAgentStore.getState().selectAgent("a1");
    useAgentStore.getState().selectAgent(null);
    expect(useAgentStore.getState().selectedAgentId).toBeNull();
  });
});

describe("toggleSession (F5: multi-session)", () => {
  it("adds session to selectedSessionIds and clears selectedAgentId", () => {
    useAgentStore.getState().selectAgent("a1");
    useAgentStore.getState().toggleSession("session-1");

    const state = useAgentStore.getState();
    expect(state.selectedSessionIds.has("session-1")).toBe(true);
    expect(state.selectedAgentId).toBeNull();
  });

  it("removes session when toggled again", () => {
    useAgentStore.getState().toggleSession("s1");
    useAgentStore.getState().toggleSession("s1");
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
  });

  it("selectAllSessions clears the set", () => {
    useAgentStore.getState().toggleSession("s1");
    useAgentStore.getState().toggleSession("s2");
    useAgentStore.getState().selectAllSessions();
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
  });
});

describe("toggleAgentType", () => {
  it("adds a type to hiddenAgentTypes", () => {
    useAgentStore.getState().toggleAgentType("main");
    expect(useAgentStore.getState().hiddenAgentTypes.has("main")).toBe(true);
  });

  it("removes a type that is already hidden", () => {
    useAgentStore.getState().toggleAgentType("main");
    expect(useAgentStore.getState().hiddenAgentTypes.has("main")).toBe(true);

    useAgentStore.getState().toggleAgentType("main");
    expect(useAgentStore.getState().hiddenAgentTypes.has("main")).toBe(false);
  });

  it("handles multiple types independently", () => {
    useAgentStore.getState().toggleAgentType("main");
    useAgentStore.getState().toggleAgentType("build");

    const hidden = useAgentStore.getState().hiddenAgentTypes;
    expect(hidden.has("main")).toBe(true);
    expect(hidden.has("build")).toBe(true);
    expect(hidden.size).toBe(2);

    useAgentStore.getState().toggleAgentType("main");
    const hidden2 = useAgentStore.getState().hiddenAgentTypes;
    expect(hidden2.has("main")).toBe(false);
    expect(hidden2.has("build")).toBe(true);
  });
});

describe("setViewMode", () => {
  it("switches to timeline", () => {
    useAgentStore.getState().setViewMode("timeline");
    expect(useAgentStore.getState().viewMode).toBe("timeline");
  });

  it("switches back to graph", () => {
    useAgentStore.getState().setViewMode("timeline");
    useAgentStore.getState().setViewMode("graph");
    expect(useAgentStore.getState().viewMode).toBe("graph");
  });
});

describe("recording", () => {
  it("startRecording sets recording to true and clears events", () => {
    useAgentStore.getState().startRecording();
    const state = useAgentStore.getState();
    expect(state.recording).toBe(true);
    expect(state.recordedEvents).toEqual([]);
  });

  it("events accumulate during recording", () => {
    useAgentStore.getState().startRecording();

    const event1: AgentEvent = {
      type: "agent:register",
      agentId: "a1",
      agentType: "main",
      task: "task 1",
    };
    const event2: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "waiting",
    };

    useAgentStore.getState().handleEvent(event1, 1000);
    useAgentStore.getState().handleEvent(event2, 2000);

    const recorded = useAgentStore.getState().recordedEvents;
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toEqual({ timestamp: 1000, event: event1 });
    expect(recorded[1]).toEqual({ timestamp: 2000, event: event2 });
  });

  it("events are not recorded when recording is off", () => {
    const event: AgentEvent = {
      type: "agent:register",
      agentId: "a1",
      agentType: "main",
      task: "task",
    };
    useAgentStore.getState().handleEvent(event, 1000);

    expect(useAgentStore.getState().recordedEvents).toHaveLength(0);
  });
});

describe("activity", () => {
  it("adds entries for each event", () => {
    registerAgent("a1");
    const activity = useAgentStore.getState().activity;
    expect(activity).toHaveLength(1);
    expect(activity[0].event.type).toBe("agent:register");
  });

  it("is capped at ACTIVITY_MAX_ENTRIES", () => {
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES + 20; i++) {
      const event: AgentEvent = {
        type: "agent:register",
        agentId: `agent-${i}`,
        agentType: "generic",
        task: `task ${i}`,
      };
      useAgentStore.getState().handleEvent(event, i);
    }

    const activity = useAgentStore.getState().activity;
    expect(activity).toHaveLength(ACTIVITY_MAX_ENTRIES);
    // The most recent event should be the last one
    const lastEvent = activity[activity.length - 1].event;
    expect(lastEvent.type).toBe("agent:register");
    if (lastEvent.type === "agent:register") {
      expect(lastEvent.agentId).toBe(`agent-${ACTIVITY_MAX_ENTRIES + 19}`);
    }
  });
});

describe("setConnected", () => {
  it("sets connected state", () => {
    useAgentStore.getState().setConnected(true);
    expect(useAgentStore.getState().connected).toBe(true);

    useAgentStore.getState().setConnected(false);
    expect(useAgentStore.getState().connected).toBe(false);
  });
});

describe("autoSelectInitialSession", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessionFilterInitialized: false, selectedSessionIds: new Set() });
  });

  it("picks the most-recently-started main session", () => {
    // handleEvent sets startTime=timestamp arg, so register with explicit timestamps via the slice directly.
    const now = Date.now();
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "old-main", agentType: "main", task: "t", sessionId: "old-main" },
      now - 60_000,
    );
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "new-main", agentType: "main", task: "t", sessionId: "new-main" },
      now,
    );

    useAgentStore.getState().autoSelectInitialSession();

    const { selectedSessionIds, sessionFilterInitialized } = useAgentStore.getState();
    expect([...selectedSessionIds]).toEqual(["new-main"]);
    expect(sessionFilterInitialized).toBe(true);
  });

  it("ignores sub-agents (parentId set) when picking the session", () => {
    const now = Date.now();
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "main1", agentType: "main", task: "t", sessionId: "main1" },
      now - 60_000,
    );
    // A *later* sub-agent must NOT be picked — only main sessions count.
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "sub1", agentType: "build", task: "t", parentId: "main1" },
      now,
    );

    useAgentStore.getState().autoSelectInitialSession();
    expect([...useAgentStore.getState().selectedSessionIds]).toEqual(["main1"]);
  });

  it("is a no-op once initialized — does not clobber a user choice", () => {
    const now = Date.now();
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "m1", agentType: "main", task: "t", sessionId: "m1" },
      now - 60_000,
    );
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "m2", agentType: "main", task: "t", sessionId: "m2" },
      now,
    );
    // User explicitly chose the older one, then a new session arrives — auto-pick must NOT switch them away.
    useAgentStore.getState().toggleSession("m1");
    expect(useAgentStore.getState().sessionFilterInitialized).toBe(true);

    useAgentStore.getState().autoSelectInitialSession();
    expect([...useAgentStore.getState().selectedSessionIds]).toEqual(["m1"]);
  });

  it("respects an explicit 'All' choice (empty set after user toggle)", () => {
    const now = Date.now();
    useAgentStore.getState().handleEvent(
      { type: "agent:register", agentId: "m1", agentType: "main", task: "t", sessionId: "m1" },
      now,
    );
    // User picked a session, then clicked All → empty set, but initialized=true.
    useAgentStore.getState().toggleSession("m1");
    useAgentStore.getState().selectAllSessions();
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
    expect(useAgentStore.getState().sessionFilterInitialized).toBe(true);

    // Auto-pick must not re-narrow them to a single session.
    useAgentStore.getState().autoSelectInitialSession();
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
  });

  it("does nothing when there are no agents yet (will retry on next arrival)", () => {
    useAgentStore.getState().autoSelectInitialSession();
    const { selectedSessionIds, sessionFilterInitialized } = useAgentStore.getState();
    expect(selectedSessionIds.size).toBe(0);
    expect(sessionFilterInitialized).toBe(false); // not initialized — leaves room for the next call to fire
  });
});
