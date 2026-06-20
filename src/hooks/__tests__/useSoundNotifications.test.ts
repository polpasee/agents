import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import type { ActivityEntry } from "@/lib/types";

// ── AudioContext mock ─────────────────────────────────────────────────────────
// The hook uses a module-level `sharedCtx`. We use vi.stubGlobal so the mock
// is in place for the static import below, and we spy on the prototype to
// count oscillator creations without needing vi.resetModules().
//
// We track calls via prototype spy: the stub class is installed once for all
// tests. vi.clearAllMocks() in beforeEach resets call counts between tests.

const oscStartSpy = vi.fn();
const oscStopSpy = vi.fn();

class MockOscillator {
  connect = vi.fn();
  frequency = {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  type: OscillatorType = "sine";
  start = oscStartSpy;
  stop = oscStopSpy;
}

const gainConnectSpy = vi.fn();

class MockGain {
  connect = gainConnectSpy;
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

class MockBiquadFilter {
  connect = vi.fn();
  type: BiquadFilterType = "lowpass";
  frequency = { value: 0 };
}

const createOscillatorSpy = vi.fn(() => new MockOscillator());
const createGainSpy = vi.fn(() => new MockGain());
const createBiquadFilterSpy = vi.fn(() => new MockBiquadFilter());

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn();
  createOscillator = createOscillatorSpy;
  createGain = createGainSpy;
  createBiquadFilter = createBiquadFilterSpy;
}

// Install before any import so the module's sharedCtx will use our mock
vi.stubGlobal("AudioContext", MockAudioContext);

// ── Static import (shares same module instance as the hook uses) ──────────────
// NOTE: static import here means the hook's `useAgentStore` is the SAME
// Zustand store instance as the one the test imports — no cross-instance leak.
import { useSoundNotifications } from "../useSoundNotifications";

// ── Helpers ───────────────────────────────────────────────────────────────────

function entry(id: string, event: ActivityEntry["event"]): ActivityEntry {
  return { id, timestamp: Date.now(), event };
}

// ── Tests: basic processing & playTone code paths ─────────────────────────────

describe("useSoundNotifications — playTone code paths", () => {
  beforeEach(() => {
    // Reset store and clear all spy call counts between tests
    useAgentStore.setState({ activity: [], soundMuted: false });
    vi.clearAllMocks();
  });

  it("initialises without error on mount", () => {
    expect(() => renderHook(() => useSoundNotifications())).not.toThrow();
  });

  it("on first render with pre-existing activity it records cursor and plays nothing", async () => {
    useAgentStore.setState({
      activity: [
        entry("act-1", {
          type: "agent:register",
          agentId: "a1",
          agentType: "main",
          task: "t",
        }),
      ],
      soundMuted: false,
    });

    renderHook(() => useSoundNotifications());

    // First run: cursor is set to act-1, no sounds played
    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });

  it("calls createOscillator on agent:register (playSpawnShimmer: 2 notes)", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    // Act 1: advance cursor to act-1
    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    const afterCursorSet = createOscillatorSpy.mock.calls.length;

    // Act 2: add act-2 → should trigger playSpawnShimmer (2 oscillators)
    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:register",
            agentId: "a2",
            agentType: "generic",
            task: "t2",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    // playSpawnShimmer schedules 2 notes
    expect(createOscillatorSpy.mock.calls.length - afterCursorSet).toBe(2);
  });

  it("calls createOscillator on agent:complete (playCompleteArpeggio: 4 notes)", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    const beforeCount = createOscillatorSpy.mock.calls.length;

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:complete",
            agentId: "a1",
            duration: 5000,
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    // playCompleteArpeggio: C4 E4 G4 B4 = 4 oscillators
    expect(createOscillatorSpy.mock.calls.length - beforeCount).toBe(4);
  });

  it("calls createOscillator on agent:tool_call (playClick: 1 oscillator)", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    const beforeCount = createOscillatorSpy.mock.calls.length;

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:tool_call",
            agentId: "a1",
            tool: "bash",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    // playClick: 1 oscillator (through biquad filter)
    expect(createOscillatorSpy.mock.calls.length - beforeCount).toBe(1);
  });

  it("calls createOscillator on agent:status error (playErrorTone: 1 oscillator)", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    const beforeCount = createOscillatorSpy.mock.calls.length;

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:status",
            agentId: "a1",
            status: "error",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    // playErrorTone: 1 oscillator
    expect(createOscillatorSpy.mock.calls.length - beforeCount).toBe(1);
  });

  it("does NOT create oscillators when soundMuted is true", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    // Advance cursor (muted)
    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: true,
      });
    });
    rerender();

    const beforeCount = createOscillatorSpy.mock.calls.length;

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:complete",
            agentId: "a1",
            duration: 1000,
          }),
        ],
        soundMuted: true,
      });
    });
    rerender();

    expect(createOscillatorSpy.mock.calls.length - beforeCount).toBe(0);
  });

  it("skips agent:status events where status is not 'error'", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    const beforeCount = createOscillatorSpy.mock.calls.length;

    await act(async () => {
      useAgentStore.setState({
        activity: [
          entry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          entry("act-2", {
            type: "agent:status",
            agentId: "a1",
            status: "running", // not error
          }),
        ],
        soundMuted: false,
      });
    });
    rerender();

    expect(createOscillatorSpy.mock.calls.length - beforeCount).toBe(0);
  });
});

// ── Tests: evicted-id startIdx logic ─────────────────────────────────────────
// These cover lines 129-131 of useSoundNotifications.ts — the fix for the
// evicted-id replay bug.

describe("useSoundNotifications — evicted lastId startIdx", () => {
  beforeEach(() => {
    useAgentStore.setState({ activity: [], soundMuted: false });
    vi.clearAllMocks();
  });

  it("evicted id produces startIdx = activity.length (no replay)", () => {
    const activity = [{ id: "new-200" }, { id: "new-201" }];
    const lastId = "old-100"; // evicted

    const idx = activity.findIndex((e) => e.id === lastId);
    const startIdx = idx === -1 ? activity.length : idx + 1;

    expect(startIdx).toBe(activity.length);
    expect(activity.slice(startIdx)).toHaveLength(0);
  });

  it("id present at mid-array gives correct startIdx", () => {
    const activity = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const lastId = "b";

    const idx = activity.findIndex((e) => e.id === lastId);
    const startIdx = idx === -1 ? activity.length : idx + 1;

    expect(startIdx).toBe(2);
    expect(activity.slice(startIdx)).toEqual([{ id: "c" }]);
  });

  it("the buggy findIndex()+1 formula yields 0 for evicted id (regression doc)", () => {
    const activity = [{ id: "new-200" }];
    const lastId = "old-100";

    // Bug: -1 + 1 = 0 → entire array treated as new
    const buggyStartIdx = activity.findIndex((e) => e.id === lastId) + 1;
    expect(buggyStartIdx).toBe(0);

    const wrongNewEntries =
      buggyStartIdx <= 0 ? activity : activity.slice(buggyStartIdx);
    expect(wrongNewEntries).toHaveLength(1); // demonstrates the bug
  });

  it("real hook does not replay events when lastId was evicted from capped activity", async () => {
    const { rerender } = renderHook(() => useSoundNotifications());

    // Build a large initial batch
    const initial = Array.from({ length: 20 }, (_, i) =>
      entry(`act-${i + 1}`, {
        type: "agent:register",
        agentId: `a${i}`,
        agentType: "main",
        task: "t",
      }),
    );

    // Set cursor (first render sets cursor without playing)
    await act(async () => {
      useAgentStore.setState({ activity: initial, soundMuted: true });
    });
    rerender();

    // Advance cursor past act-20
    await act(async () => {
      useAgentStore.setState({
        activity: [
          ...initial,
          entry("act-21", {
            type: "agent:complete",
            agentId: "a0",
            duration: 100,
          }),
        ],
        soundMuted: true,
      });
    });
    rerender();

    vi.clearAllMocks(); // Reset counts after cursor setup

    // Now simulate cap eviction: replace all with entirely new ids
    // The hook's lastId (act-21) is NOT in this new array
    const evicted = [
      entry("act-200", {
        type: "agent:complete",
        agentId: "aX",
        duration: 100,
      }),
      entry("act-201", {
        type: "agent:complete",
        agentId: "aY",
        duration: 100,
      }),
    ];

    await act(async () => {
      // soundMuted = false so we'd hear sounds IF any were incorrectly replayed
      useAgentStore.setState({ activity: evicted, soundMuted: false });
    });
    rerender();

    // With the fix: startIdx = evicted.length (2) → slice(2) = [] → no sounds
    // With the bug: startIdx = 0 → both entries replayed (8 oscillators for 2 completes)
    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });
});
