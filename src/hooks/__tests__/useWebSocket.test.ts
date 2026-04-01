import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useWebSocket } from "../useWebSocket";

const instances: any[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  readyState = MockWebSocket.OPEN;
  onopen: any = null;
  onclose: any = null;
  onmessage: any = null;
  onerror: any = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    useAgentStore.setState({
      connected: false,
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
    vi.unstubAllGlobals();
  });

  it("connects on mount", () => {
    renderHook(() => useWebSocket());

    expect(instances).toHaveLength(1);
  });

  it("setConnected on open", () => {
    renderHook(() => useWebSocket());

    expect(useAgentStore.getState().connected).toBe(false);

    // Trigger the onopen callback
    vi.advanceTimersByTime(1);

    expect(useAgentStore.getState().connected).toBe(true);
  });

  it("cleanup closes WebSocket on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());

    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(1);

    unmount();

    expect(instances[0].close).toHaveBeenCalled();
  });

  it("skips connection during replay", () => {
    useAgentStore.setState({
      replay: {
        active: true,
        playing: false,
        speed: 1,
        currentTime: 0,
        currentIndex: 0,
        startTime: 0,
        endTime: 0,
        session: null,
      },
    });

    renderHook(() => useWebSocket());

    expect(instances).toHaveLength(0);
  });
});
