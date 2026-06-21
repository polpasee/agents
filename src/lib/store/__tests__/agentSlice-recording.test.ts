import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../store";
import type { AgentEvent } from "../../types";
import { RECORDING_MAX_EVENTS } from "../../config";

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

function emitRegister(agentId: string, timestamp: number): void {
  const event: AgentEvent = {
    type: "agent:register",
    agentId,
    agentType: "build",
    task: `task-${agentId}`,
  };
  useAgentStore.getState().handleEvent(event, timestamp);
}

describe("recordedEvents ring buffer", () => {
  it("does not append when recording is off", () => {
    emitRegister("a1", 1000);
    emitRegister("a2", 2000);
    expect(useAgentStore.getState().recordedEvents).toHaveLength(0);
  });

  it("appends events when recording is on", () => {
    useAgentStore.getState().startRecording();
    for (let i = 0; i < 100; i++) {
      emitRegister(`agent-${i}`, i);
    }
    expect(useAgentStore.getState().recordedEvents).toHaveLength(100);
  });

  it("caps at RECORDING_MAX_EVENTS and drops the oldest", () => {
    // Pre-fill the buffer to just below the cap so we only need a few handleEvent
    // calls to trigger the eviction — avoiding a 50k-iteration loop in tests.
    useAgentStore.getState().startRecording();
    const buf = useAgentStore.getState().recordedEvents;
    const event: AgentEvent = {
      type: "agent:register",
      agentId: "seed",
      agentType: "build",
      task: "t",
    };
    // Seed RECORDING_MAX_EVENTS - 1 entries with timestamps 0 .. cap-2.
    for (let i = 0; i < RECORDING_MAX_EVENTS - 1; i++) {
      buf.push({ timestamp: i, event });
    }
    // Emit 100 more via handleEvent to trigger eviction (timestamps cap-1 .. cap+98).
    for (let i = 0; i < 100; i++) {
      emitRegister(`agent-${i}`, RECORDING_MAX_EVENTS - 1 + i);
    }
    const recorded = useAgentStore.getState().recordedEvents;
    expect(recorded).toHaveLength(RECORDING_MAX_EVENTS);
    // The oldest entries (timestamp 0..98) must have been evicted.
    // safe: toHaveLength(RECORDING_MAX_EVENTS) asserts indices 0 and length-1 exist
    expect(recorded[0]!.timestamp).toBeGreaterThanOrEqual(99);
    // The newest timestamp must be present.
    expect(recorded[RECORDING_MAX_EVENTS - 1]!.timestamp).toBe(
      RECORDING_MAX_EVENTS - 1 + 99,
    );
  });

  it("recordedEvents is a NEW array after each event (immutable update)", () => {
    useAgentStore.getState().startRecording();
    const before = useAgentStore.getState().recordedEvents;
    emitRegister("agent-0", 0);
    const after = useAgentStore.getState().recordedEvents;
    // Must be a new array reference — not the snapshot array mutated in place.
    expect(after).not.toBe(before);
    expect(after).toHaveLength(1);
  });

  it("recordedEvents has length N after N events and is distinct from pre-recording array", () => {
    useAgentStore.getState().startRecording();
    const before = useAgentStore.getState().recordedEvents;
    for (let i = 0; i < 5; i++) {
      emitRegister(`agent-${i}`, i);
    }
    const after = useAgentStore.getState().recordedEvents;
    expect(after).toHaveLength(5);
    expect(after).not.toBe(before);
  });
});
