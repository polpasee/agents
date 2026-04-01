import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useReplay } from "../useReplay";

describe("useReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAgentStore.setState({
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when replay is not active", () => {
    useAgentStore.setState({
      replay: {
        active: false,
        playing: false,
        speed: 1,
        currentTime: 0,
        currentIndex: 0,
        startTime: 0,
        endTime: 1000,
        session: null,
      },
    });

    const replayTick = vi.fn();
    useAgentStore.setState({ replayTick });

    renderHook(() => useReplay());

    vi.advanceTimersByTime(500);

    expect(replayTick).not.toHaveBeenCalled();
  });

  it("does nothing when active but not playing", () => {
    useAgentStore.setState({
      replay: {
        active: true,
        playing: false,
        speed: 1,
        currentTime: 0,
        currentIndex: 0,
        startTime: 0,
        endTime: 1000,
        session: { startTime: 0, events: [] },
      },
    });

    const replayTick = vi.fn();
    useAgentStore.setState({ replayTick });

    renderHook(() => useReplay());

    vi.advanceTimersByTime(500);

    expect(replayTick).not.toHaveBeenCalled();
  });

  it("cleanup clears timer on unmount", () => {
    useAgentStore.setState({
      replay: {
        active: true,
        playing: true,
        speed: 1,
        currentTime: 0,
        currentIndex: 0,
        startTime: 0,
        endTime: 10000,
        session: { startTime: 0, events: [] },
      },
    });

    const { unmount } = renderHook(() => useReplay());

    // Advance one tick to start the timer
    vi.advanceTimersByTime(50);

    unmount();

    // After unmount, replayTick should not be called further
    const replayTick = vi.fn();
    useAgentStore.setState({ replayTick });

    vi.advanceTimersByTime(500);

    expect(replayTick).not.toHaveBeenCalled();
  });
});
