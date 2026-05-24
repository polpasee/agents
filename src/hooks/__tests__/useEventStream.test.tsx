import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEventStream } from "../useEventStream";
import { useAgentStore } from "@/lib/store";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  close() { this.closed = true; }
}

describe("useEventStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    useAgentStore.setState({ agents: new Map(), edges: [], teams: new Map(), connected: false });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("connects to /api/stream and sets connected=true on open", async () => {
    renderHook(() => useEventStream());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/stream");
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });
    expect(useAgentStore.getState().connected).toBe(true);
  });

  it("handles state:sync by populating agents/edges/teams", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "state:sync",
        agents: [{ id: "a", agentType: "main", status: "running", task: "t",
          toolCalls: [], inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        edges: [],
        teams: [],
        protocolVersion: 1,
      });
    });
    expect(useAgentStore.getState().agents.has("a")).toBe(true);
  });

  it("buffers state:update events and flushes them", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Seed an agent so the agent:tool_call update has something to land on
    act(() => {
      useAgentStore.getState().syncState(
        [{ id: "main-x", agentType: "main", status: "running", task: "t",
           toolCalls: [], inputTokens: 0, outputTokens: 0,
           cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        [], [],
      );
    });

    act(() => {
      es.emit({
        type: "state:update",
        event: { type: "agent:tool_call", agentId: "main-x", tool: "Read" },
        timestamp: 1700000000000,
      });
    });
    // Wait for the 16ms batch flush
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    const agent = useAgentStore.getState().agents.get("main-x");
    expect(agent?.toolCalls.some((tc) => tc.tool === "Read")).toBe(true);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it("handles annotation:update add by writing to the store", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "annotation:update",
        action: "add",
        annotation: { id: "ann-x", targetId: "main", targetType: "agent", text: "hi", timestamp: 1 },
      });
    });
    expect(useAgentStore.getState().annotations.has("ann-x")).toBe(true);
  });
});
