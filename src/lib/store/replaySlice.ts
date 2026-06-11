import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";

export type ReplaySlice = Pick<AgentStore,
  | "replay"
  | "loadReplaySession" | "replayPlay" | "replayPause"
  | "replaySeek" | "replaySetSpeed" | "replayExit" | "replayTick"
>;

/** Graph-state reset applied whenever replay rebuilds from scratch
 *  (load / seek / exit). */
function graphReset(prevTopologyVersion: number): Partial<AgentStore> {
  return {
    agents: new Map(),
    edges: [],
    activity: [],
    nextActivityId: 0,
    topologyVersion: prevTopologyVersion + 1,
    teams: new Map(),
    errorDetails: new Map(),
  };
}

export const createReplaySlice: StateCreator<AgentStore, [], [], ReplaySlice> = (set, get) => ({
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

  loadReplaySession: (session) => {
    const endTime = session.events.length > 0
      ? session.events[session.events.length - 1].timestamp
      : session.startTime;
    set({
      ...graphReset(get().topologyVersion),
      selectedAgentId: null,
      selectedTeamId: null,
      selectedWorkflowId: null,
      replay: {
        active: true,
        session,
        playing: false,
        speed: 1,
        currentIndex: 0,
        currentTime: session.startTime,
        startTime: session.startTime,
        endTime,
      },
    });
  },

  replayPlay: () => {
    const { replay } = get();
    if (!replay.active) return;
    // If we're at (or past) the end and the session has events, rewind to start.
    const events = replay.session?.events ?? [];
    if (replay.currentTime >= replay.endTime && events.length > 0) {
      get().replaySeek(replay.startTime);
    }
    set({ replay: { ...get().replay, playing: true } });
  },

  replayPause: () => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, playing: false } });
  },

  replaySeek: (timestamp) => {
    const { replay } = get();
    if (!replay.active || !replay.session) return;
    // Clamp to [startTime, endTime] — out-of-range seeks leave UI at nonsensical times
    const clamped = Math.max(replay.startTime, Math.min(timestamp, replay.endTime));
    set({
      ...graphReset(get().topologyVersion),
      replay: { ...replay, currentIndex: 0, currentTime: replay.startTime },
    });
    get().replayTick(clamped);
  },

  replaySetSpeed: (speed) => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, speed } });
  },

  replayExit: () => {
    set({
      ...graphReset(get().topologyVersion),
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
    });
  },

  replayTick: (upToTimestamp) => {
    const { replay, handleEvent } = get();
    if (!replay.active || !replay.session) return;
    const clamped = Math.max(replay.startTime, Math.min(upToTimestamp, replay.endTime));
    const events = replay.session.events;
    let idx = replay.currentIndex;
    while (idx < events.length && events[idx].timestamp <= clamped) {
      handleEvent(events[idx].event, events[idx].timestamp);
      idx++;
    }
    const newReplay = get().replay;
    set({ replay: { ...newReplay, currentIndex: idx, currentTime: clamped } });
  },
});
