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
        { timestamp: t1, event: { type: "agent:complete", agentId: "a1", duration: 500 } },
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
