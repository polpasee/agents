import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";
import type { ReplayState, ReplaySpeed, RecordedSession } from "../types";

export type ReplaySlice = Pick<AgentStore,
  | "replay"
  | "loadReplaySession" | "replayPlay" | "replayPause"
  | "replaySeek" | "replaySetSpeed" | "replayExit" | "replayTick"
>;

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
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
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
    if (replay.active) set({ replay: { ...replay, playing: true } });
  },

  replayPause: () => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, playing: false } });
  },

  replaySeek: (timestamp) => {
    const { replay } = get();
    if (!replay.active || !replay.session) return;
    set({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      replay: { ...replay, currentIndex: 0, currentTime: replay.startTime },
    });
    get().replayTick(timestamp);
  },

  replaySetSpeed: (speed) => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, speed } });
  },

  replayExit: () => {
    set({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
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
    const events = replay.session.events;
    let idx = replay.currentIndex;
    while (idx < events.length && events[idx].timestamp <= upToTimestamp) {
      handleEvent(events[idx].event, events[idx].timestamp);
      idx++;
    }
    const newReplay = get().replay;
    set({ replay: { ...newReplay, currentIndex: idx, currentTime: upToTimestamp } });
  },
});
