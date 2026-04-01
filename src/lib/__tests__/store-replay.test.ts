import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";
import type { RecordedSession } from "../types";

const mockSession: RecordedSession = {
  startTime: 1000,
  events: [
    {
      timestamp: 1000,
      event: {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "build feature",
      },
    },
    {
      timestamp: 2000,
      event: {
        type: "agent:status",
        agentId: "a1",
        status: "running",
      },
    },
    {
      timestamp: 3000,
      event: {
        type: "agent:register",
        agentId: "a2",
        agentType: "test",
        task: "run tests",
        parentId: "a1",
      },
    },
    {
      timestamp: 4000,
      event: {
        type: "agent:status",
        agentId: "a2",
        status: "completed",
      },
    },
    {
      timestamp: 5000,
      event: {
        type: "agent:status",
        agentId: "a1",
        status: "completed",
      },
    },
  ],
};

beforeEach(() => {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    connected: false,
    teams: new Map(),
    selectedTeamId: null,
    hiddenAgentTypes: new Set(),
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
    replay: {
      active: false,
      session: null,
      playing: false,
      speed: 1,
      currentIndex: 0,
      currentTime: 0,
      startTime: 0,
      endTime: 0,
    },
    logEntries: new Map(),
    logLoading: new Set(),
    logViewerAgentId: null,
  });
});

describe("loadReplaySession", () => {
  it("clears agents and edges and sets replay.active=true", () => {
    // Pre-populate some state so we can verify it gets cleared
    const agents = new Map();
    agents.set("existing", {
      id: "existing",
      agentType: "main" as const,
      status: "running" as const,
      task: "old",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
      startTime: 0,
    });
    useAgentStore.setState({
      agents,
      edges: [{ source: "a", target: "b" }],
    });

    useAgentStore.getState().loadReplaySession(mockSession);

    const state = useAgentStore.getState();
    expect(state.agents.size).toBe(0);
    expect(state.edges).toHaveLength(0);
    expect(state.replay.active).toBe(true);
    expect(state.replay.session).toBe(mockSession);
    expect(state.replay.playing).toBe(false);
    expect(state.replay.speed).toBe(1);
    expect(state.replay.startTime).toBe(1000);
    expect(state.replay.endTime).toBe(5000);
  });
});

describe("replayPlay", () => {
  it("sets replay.playing=true when replay is active", () => {
    useAgentStore.getState().loadReplaySession(mockSession);
    useAgentStore.getState().replayPlay();

    expect(useAgentStore.getState().replay.playing).toBe(true);
  });

  it("does not set playing when replay is not active", () => {
    useAgentStore.getState().replayPlay();

    expect(useAgentStore.getState().replay.playing).toBe(false);
  });
});

describe("replayPause", () => {
  it("sets replay.playing=false", () => {
    useAgentStore.getState().loadReplaySession(mockSession);
    useAgentStore.getState().replayPlay();
    expect(useAgentStore.getState().replay.playing).toBe(true);

    useAgentStore.getState().replayPause();
    expect(useAgentStore.getState().replay.playing).toBe(false);
  });
});

describe("replaySetSpeed", () => {
  it("changes the replay speed", () => {
    useAgentStore.getState().loadReplaySession(mockSession);

    useAgentStore.getState().replaySetSpeed(2);
    expect(useAgentStore.getState().replay.speed).toBe(2);

    useAgentStore.getState().replaySetSpeed(4);
    expect(useAgentStore.getState().replay.speed).toBe(4);

    useAgentStore.getState().replaySetSpeed(0.5);
    expect(useAgentStore.getState().replay.speed).toBe(0.5);
  });
});

describe("replayTick", () => {
  it("dispatches events up to the given timestamp", () => {
    useAgentStore.getState().loadReplaySession(mockSession);

    // Tick up to timestamp 2000 should process the first 2 events
    useAgentStore.getState().replayTick(2000);

    const state = useAgentStore.getState();
    expect(state.agents.size).toBe(1);
    expect(state.agents.get("a1")).toBeDefined();
    expect(state.agents.get("a1")!.status).toBe("running");
    expect(state.replay.currentIndex).toBe(2);
    expect(state.replay.currentTime).toBe(2000);
  });

  it("processes additional events on subsequent ticks", () => {
    useAgentStore.getState().loadReplaySession(mockSession);

    useAgentStore.getState().replayTick(2000);
    expect(useAgentStore.getState().agents.size).toBe(1);

    useAgentStore.getState().replayTick(3500);
    const state = useAgentStore.getState();
    expect(state.agents.size).toBe(2);
    expect(state.agents.get("a2")).toBeDefined();
    expect(state.replay.currentIndex).toBe(3);
  });

  it("does nothing when replay is not active", () => {
    useAgentStore.getState().replayTick(5000);
    expect(useAgentStore.getState().agents.size).toBe(0);
  });
});

describe("replaySeek", () => {
  it("resets and replays from beginning to target timestamp", () => {
    useAgentStore.getState().loadReplaySession(mockSession);

    // First tick forward
    useAgentStore.getState().replayTick(5000);
    expect(useAgentStore.getState().agents.size).toBe(2);

    // Seek to an earlier point - should reset and replay up to timestamp 1500
    useAgentStore.getState().replaySeek(1500);
    const state = useAgentStore.getState();
    // Only the first event (timestamp 1000) should have been processed
    expect(state.agents.size).toBe(1);
    expect(state.agents.get("a1")).toBeDefined();
    expect(state.agents.get("a2")).toBeUndefined();
    expect(state.replay.currentTime).toBe(1500);
  });
});

describe("replayExit", () => {
  it("clears everything and sets active=false", () => {
    useAgentStore.getState().loadReplaySession(mockSession);
    useAgentStore.getState().replayTick(5000);
    expect(useAgentStore.getState().agents.size).toBe(2);
    expect(useAgentStore.getState().replay.active).toBe(true);

    useAgentStore.getState().replayExit();

    const state = useAgentStore.getState();
    expect(state.agents.size).toBe(0);
    expect(state.edges).toHaveLength(0);
    expect(state.activity).toHaveLength(0);
    expect(state.replay.active).toBe(false);
    expect(state.replay.session).toBeNull();
    expect(state.replay.playing).toBe(false);
    expect(state.replay.speed).toBe(1);
    expect(state.replay.currentIndex).toBe(0);
    expect(state.replay.currentTime).toBe(0);
  });
});
