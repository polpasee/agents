import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../store";
import type { AgentEvent } from "../../types";

function resetStore() {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    nextActivityId: 0,
    topologyVersion: 0,
    errorDetails: new Map(),
    teams: new Map(),
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    connected: false,
    recording: false,
    recordedEvents: [],
    replay: {
      active: false,
      playing: false,
      speed: 1,
      currentTime: 0,
      currentIndex: 0,
      startTime: 0,
      endTime: 0,
      session: null,
    },
  });
}

beforeEach(resetStore);

const registerEvent: AgentEvent = {
  type: "agent:register",
  agentId: "a1",
  agentType: "build",
  task: "t",
};

// ── loadReplaySession edge cases ────────────────────────────────────────────

describe("loadReplaySession", () => {
  it("sets endTime to startTime when session has no events", () => {
    const ts = 5000;
    useAgentStore.getState().loadReplaySession({ startTime: ts, events: [] });
    const replay = useAgentStore.getState().replay;
    expect(replay.active).toBe(true);
    expect(replay.endTime).toBe(ts);
    expect(replay.currentTime).toBe(ts);
  });

  it("resets agent/team/edge state on load", () => {
    useAgentStore.setState({
      agents: new Map([["a-old", { id: "a-old" } as never]]),
      edges: [{ source: "a", target: "b" }],
    });
    useAgentStore.getState().loadReplaySession({ startTime: 1000, events: [] });
    expect(useAgentStore.getState().agents.size).toBe(0);
    expect(useAgentStore.getState().edges).toHaveLength(0);
  });
});

// ── replayPause ─────────────────────────────────────────────────────────────

describe("replayPause", () => {
  it("sets playing=false when replay is active", () => {
    useAgentStore.getState().loadReplaySession({ startTime: 1000, events: [] });
    useAgentStore.setState((s) => ({ replay: { ...s.replay, playing: true } }));
    useAgentStore.getState().replayPause();
    expect(useAgentStore.getState().replay.playing).toBe(false);
  });

  it("does nothing when replay is not active", () => {
    // replay is inactive by default (from beforeEach resetStore)
    const before = useAgentStore.getState().replay;
    useAgentStore.getState().replayPause();
    expect(useAgentStore.getState().replay).toEqual(before);
  });
});

// ── replaySeek ──────────────────────────────────────────────────────────────

describe("replaySeek", () => {
  it("does nothing when replay is not active", () => {
    const before = useAgentStore.getState().replay;
    useAgentStore.getState().replaySeek(2000);
    expect(useAgentStore.getState().replay).toEqual(before);
  });

  it("clamps seek to startTime when timestamp is below range", () => {
    const t0 = 1000;
    useAgentStore.getState().loadReplaySession({
      startTime: t0,
      events: [{ timestamp: t0 + 500, event: registerEvent }],
    });
    useAgentStore.getState().replaySeek(t0 - 500); // below startTime
    expect(useAgentStore.getState().replay.currentTime).toBe(t0);
  });

  it("clamps seek to endTime when timestamp is above range", () => {
    const t0 = 1000;
    const t1 = 2000;
    useAgentStore.getState().loadReplaySession({
      startTime: t0,
      events: [{ timestamp: t1, event: registerEvent }],
    });
    useAgentStore.getState().replaySeek(t1 + 9999); // above endTime
    expect(useAgentStore.getState().replay.currentTime).toBe(t1);
  });
});

// ── replaySetSpeed ──────────────────────────────────────────────────────────

describe("replaySetSpeed", () => {
  it("updates speed when replay is active", () => {
    useAgentStore.getState().loadReplaySession({ startTime: 1000, events: [] });
    useAgentStore.getState().replaySetSpeed(2);
    expect(useAgentStore.getState().replay.speed).toBe(2);
  });

  it("does nothing when replay is not active", () => {
    const before = useAgentStore.getState().replay;
    useAgentStore.getState().replaySetSpeed(4);
    expect(useAgentStore.getState().replay.speed).toBe(before.speed);
  });
});

// ── replayPlay edge: no active replay ──────────────────────────────────────

describe("replayPlay — guard", () => {
  it("does nothing when replay is not active", () => {
    const before = useAgentStore.getState().replay;
    useAgentStore.getState().replayPlay();
    expect(useAgentStore.getState().replay).toEqual(before);
  });
});

// Bug 5 — single-event session (endTime === startTime) stuck at end.
describe("replayPlay — single-event session rewind", () => {
  it("rewinds and sets playing=true when currentTime >= endTime and endTime === startTime", () => {
    const ts = 1000;
    useAgentStore.getState().loadReplaySession({
      startTime: ts,
      events: [{ timestamp: ts, event: registerEvent }],
    });

    // currentTime should equal startTime (= endTime) right after load
    const replayAfterLoad = useAgentStore.getState().replay;
    expect(replayAfterLoad.currentTime).toBe(ts);
    expect(replayAfterLoad.endTime).toBe(ts);
    expect(replayAfterLoad.startTime).toBe(ts);

    // Press play — must rewind then set playing=true (should not be stuck)
    useAgentStore.getState().replayPlay();
    expect(useAgentStore.getState().replay.playing).toBe(true);
  });

  it("rewinds a fully-played single-event session when play is pressed again", () => {
    const ts = 2000;
    useAgentStore.getState().loadReplaySession({
      startTime: ts,
      events: [{ timestamp: ts, event: registerEvent }],
    });

    // Manually advance currentIndex past the end (as if replayTick ran once).
    // We also verify the agent from the first play was registered.
    useAgentStore.setState((s) => ({
      replay: { ...s.replay, currentIndex: 1, currentTime: ts },
    }));

    useAgentStore.getState().replayPlay();
    // After rewind+play, the session replays from the start.
    // replaySeek(startTime) → replayTick(startTime) processes the single event
    // (timestamp === startTime), so currentIndex ends up at 1 again (event consumed).
    // What matters: playing=true and the agent is registered again.
    expect(useAgentStore.getState().replay.playing).toBe(true);
    // The event was replayed — the agent should be in the store.
    expect(useAgentStore.getState().agents.has("a1")).toBe(true);
  });

  it("still rewinds a normal multi-event session at the end", () => {
    const t0 = 1000;
    const t1 = 2000;
    useAgentStore.getState().loadReplaySession({
      startTime: t0,
      events: [
        { timestamp: t0, event: registerEvent },
        {
          timestamp: t1,
          event: { type: "agent:complete", agentId: "a1", duration: 500 },
        },
      ],
    });

    // Seek to the end
    useAgentStore.getState().replaySeek(t1);
    // currentTime is now at endTime (t1)
    expect(useAgentStore.getState().replay.currentTime).toBe(t1);

    useAgentStore.getState().replayPlay();
    // Should have rewound
    expect(useAgentStore.getState().replay.currentTime).toBe(t0);
    expect(useAgentStore.getState().replay.playing).toBe(true);
  });
});
