import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { useWebSocket } from "../useWebSocket";
import { WS_BATCH_INTERVAL_MS, WS_BATCH_MAX_SIZE } from "@/lib/config";

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

/** Helper: send a state:update message through the mock WebSocket */
function sendUpdate(ws: any, agentEvent: any, timestamp = Date.now()) {
  ws.onmessage({
    data: JSON.stringify({
      type: "state:update",
      event: agentEvent,
      timestamp,
    }),
  });
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

  it("stays connected during replay but ignores live state updates", () => {
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
    vi.advanceTimersByTime(1);
    // Connection is kept alive — tearing it down on every replay toggle
    // would lose buffered events and reset reconnect backoff.
    expect(instances).toHaveLength(1);

    const ws = instances[0];
    ws.onmessage({
      data: JSON.stringify({
        type: "state:update",
        event: {
          type: "agent:register",
          agentId: "live-during-replay",
          agentType: "main",
          task: "t",
        },
        timestamp: 1000,
      }),
    });
    vi.advanceTimersByTime(WS_BATCH_INTERVAL_MS);
    // Live event dropped — replay is active
    expect(useAgentStore.getState().agents.has("live-during-replay")).toBe(false);
  });

  describe("event batching", () => {
    function makeRegisterEvent(agentId: string) {
      return {
        type: "agent:register" as const,
        agentId,
        agentType: "main",
        task: "test",
        sessionId: "s1",
        slug: agentId,
        model: "test-model",
      };
    }

    it("buffers state:update events and flushes after batch interval", () => {
      renderHook(() => useWebSocket());
      vi.advanceTimersByTime(1); // trigger onopen
      const ws = instances[0];

      // Send 3 rapid state:update events
      sendUpdate(ws, makeRegisterEvent("a1"), 1000);
      sendUpdate(ws, makeRegisterEvent("a2"), 1001);
      sendUpdate(ws, makeRegisterEvent("a3"), 1002);

      // Before the batch interval, store should NOT have the agents yet
      expect(useAgentStore.getState().agents.size).toBe(0);

      // Advance past the batch interval — buffer should flush
      vi.advanceTimersByTime(WS_BATCH_INTERVAL_MS);

      expect(useAgentStore.getState().agents.size).toBe(3);
      expect(useAgentStore.getState().agents.has("a1")).toBe(true);
      expect(useAgentStore.getState().agents.has("a2")).toBe(true);
      expect(useAgentStore.getState().agents.has("a3")).toBe(true);
    });

    it("processes state:sync immediately (not batched)", () => {
      renderHook(() => useWebSocket());
      vi.advanceTimersByTime(1);
      const ws = instances[0];

      const agent = {
        id: "sync-agent",
        agentType: "main",
        status: "running",
        task: "test",
        sessionId: "s1",
        slug: "sync-agent",
        model: "test-model",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 100000,
        startTime: 1000,
      };

      ws.onmessage({
        data: JSON.stringify({
          type: "state:sync",
          agents: [agent],
          edges: [],
          teams: [],
        }),
      });

      // Should be applied immediately, no timer needed
      expect(useAgentStore.getState().agents.size).toBe(1);
      expect(useAgentStore.getState().agents.has("sync-agent")).toBe(true);
    });

    it("processes state:remove immediately (not batched)", () => {
      // Pre-populate an agent
      const agents = new Map();
      agents.set("rm-agent", {
        id: "rm-agent",
        agentType: "main",
        status: "running",
        task: "test",
        sessionId: "s1",
        slug: "rm-agent",
        model: "test-model",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 100000,
        startTime: 1000,
      });
      useAgentStore.setState({ agents });

      renderHook(() => useWebSocket());
      vi.advanceTimersByTime(1);
      const ws = instances[0];

      ws.onmessage({
        data: JSON.stringify({ type: "state:remove", agentId: "rm-agent" }),
      });

      // Should be removed immediately
      expect(useAgentStore.getState().agents.has("rm-agent")).toBe(false);
    });

    it("force-flushes when buffer reaches max size", () => {
      renderHook(() => useWebSocket());
      vi.advanceTimersByTime(1);
      const ws = instances[0];

      // Send exactly WS_BATCH_MAX_SIZE events without advancing timers
      for (let i = 0; i < WS_BATCH_MAX_SIZE; i++) {
        sendUpdate(ws, makeRegisterEvent(`batch-${i}`), 2000 + i);
      }

      // Should have flushed synchronously when hitting the limit
      expect(useAgentStore.getState().agents.size).toBe(WS_BATCH_MAX_SIZE);
    });

    it("flushes remaining events on unmount", () => {
      useAgentStore.setState({ agents: new Map() });
      const { unmount } = renderHook(() => useWebSocket());
      vi.advanceTimersByTime(1);
      const ws = instances[0];

      sendUpdate(ws, makeRegisterEvent("unmount-a1"), 3000);
      sendUpdate(ws, makeRegisterEvent("unmount-a2"), 3001);

      // Events are buffered, not yet applied
      expect(useAgentStore.getState().agents.size).toBe(0);

      // Unmount should flush the buffer
      unmount();

      expect(useAgentStore.getState().agents.size).toBe(2);
      expect(useAgentStore.getState().agents.has("unmount-a1")).toBe(true);
      expect(useAgentStore.getState().agents.has("unmount-a2")).toBe(true);
    });
  });
});
