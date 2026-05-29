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

  // F1 — state:sync must drop any buffered state:update events so the
  // pre-disconnect deltas don't flush onto the fresh snapshot.
  it("drops the buffered state:update events when a fresh state:sync arrives", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Seed an agent so the buffered tool_call would otherwise land on it
    act(() => {
      useAgentStore.getState().syncState(
        [{ id: "main-x", agentType: "main", status: "running", task: "old",
           toolCalls: [], inputTokens: 0, outputTokens: 0,
           cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        [], [],
      );
    });

    // Enqueue a state:update — sits in the batch buffer waiting for flush
    act(() => {
      es.emit({
        type: "state:update",
        event: { type: "agent:tool_call", agentId: "main-x", tool: "ShouldNotApply" },
        timestamp: 1700000000000,
      });
    });

    // Before the 16ms flush fires, deliver a fresh state:sync that replaces
    // the topology. The buffered tool_call must be dropped, not flushed onto
    // the new snapshot.
    act(() => {
      es.emit({
        type: "state:sync",
        agents: [{ id: "main-y", agentType: "main", status: "running", task: "fresh",
          toolCalls: [], inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        edges: [],
        teams: [],
        protocolVersion: 1,
      });
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });

    const state = useAgentStore.getState();
    expect(state.agents.has("main-y")).toBe(true);
    expect(state.agents.has("main-x")).toBe(false);
    // Buffered tool_call must NOT have applied to anything
    expect(state.agents.get("main-y")?.toolCalls).toHaveLength(0);
  });

  // F2 — annotation:sync replaces the full client annotation map so server
  // evictions/deletes propagate after reconnect.
  it("replaces the entire annotations map on annotation:sync", async () => {
    // Pre-populate annotations
    useAgentStore.setState({
      annotations: new Map([
        ["stale-1", { id: "stale-1", targetId: "a", targetType: "agent", text: "old", timestamp: 1 }],
        ["keep-1", { id: "keep-1", targetId: "a", targetType: "agent", text: "kept", timestamp: 2 }],
      ]),
    });

    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "annotation:sync",
        annotations: [
          { id: "keep-1", targetId: "a", targetType: "agent", text: "kept", timestamp: 2 },
          { id: "new-1", targetId: "b", targetType: "agent", text: "new", timestamp: 3 },
        ],
      });
    });

    const annotations = useAgentStore.getState().annotations;
    expect(annotations.has("stale-1")).toBe(false);
    expect(annotations.has("keep-1")).toBe(true);
    expect(annotations.has("new-1")).toBe(true);
  });

  // F5 — onerror must not race with unmount and overwrite a remount's
  // connected=true.
  it("does not call setConnected from onerror after the hook is unmounted", async () => {
    const { unmount } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Unmount and then put the store in connected=true (mimicking a remount
    // that succeeded). The stale onerror must NOT overwrite it.
    unmount();
    useAgentStore.setState({ connected: true });
    act(() => { es.onerror?.(new Event("error")); });
    expect(useAgentStore.getState().connected).toBe(true);
  });

  // F6 — buffered state:update events must NOT apply if replay was toggled on
  // between enqueue and flush.
  it("drops buffered state:update events when replay activates before flush", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      useAgentStore.getState().syncState(
        [{ id: "main-z", agentType: "main", status: "running", task: "t",
           toolCalls: [], inputTokens: 0, outputTokens: 0,
           cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        [], [],
      );
    });

    // Replay is off — emit a state:update so it lands in the buffer
    act(() => {
      es.emit({
        type: "state:update",
        event: { type: "agent:tool_call", agentId: "main-z", tool: "ReplayDropMe" },
        timestamp: 1700000000000,
      });
    });

    // Flip replay on before the flush timer fires
    act(() => {
      useAgentStore.setState((s) => ({ replay: { ...s.replay, active: true } }));
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });

    const agent = useAgentStore.getState().agents.get("main-z");
    expect(agent?.toolCalls.some((tc) => tc.tool === "ReplayDropMe")).toBe(false);
  });

  // Bug 2 — flushEventBuffer must not dispatch after teardown (destroyed guard).
  it("does not dispatch buffered events after the hook is unmounted (destroyed guard)", async () => {
    const { unmount } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Seed an agent so a buffered event would apply to it
    act(() => {
      useAgentStore.getState().syncState(
        [{ id: "main-d", agentType: "main", status: "running", task: "t",
           toolCalls: [], inputTokens: 0, outputTokens: 0,
           cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        [], [],
      );
    });

    // Buffer a state:update — sits in the batch buffer
    act(() => {
      es.emit({
        type: "state:update",
        event: { type: "agent:tool_call", agentId: "main-d", tool: "DestroyedFlush" },
        timestamp: 1700000000001,
      });
    });

    // Unmount immediately — cleanup sets destroyed=true then calls flushEventBuffer.
    unmount();

    // Even after the normal flush delay, the event must not have landed.
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });

    const agent = useAgentStore.getState().agents.get("main-d");
    expect(agent?.toolCalls.some((tc) => tc.tool === "DestroyedFlush")).toBe(false);
  });

  // Annotations are independent of the replay timeline (replay only scrubs
  // agents/edges/teams), so annotation:sync/update must apply LIVE even during
  // replay — gating them would drop deltas with no resync path on replay exit.
  it("applies annotation:sync even when replay is active", async () => {
    useAgentStore.setState({
      annotations: new Map([
        ["existing", { id: "existing", targetId: "a", targetType: "agent", text: "keep", timestamp: 1 }],
      ]),
    });

    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Activate replay mode
    act(() => {
      useAgentStore.setState((s) => ({ replay: { ...s.replay, active: true } }));
    });

    // Fire annotation:sync while replay is active — must still apply
    act(() => {
      es.emit({
        type: "annotation:sync",
        annotations: [
          { id: "new-ann", targetId: "b", targetType: "agent", text: "live", timestamp: 2 },
        ],
      });
    });

    const annotations = useAgentStore.getState().annotations;
    expect(annotations.has("new-ann")).toBe(true);
  });

  it("calls replaceAnnotations on annotation:sync when replay is NOT active", async () => {
    useAgentStore.setState({ annotations: new Map() });
    useAgentStore.setState((s) => ({ replay: { ...s.replay, active: false } }));

    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "annotation:sync",
        annotations: [
          { id: "ann-live", targetId: "a", targetType: "agent", text: "live", timestamp: 1 },
        ],
      });
    });

    expect(useAgentStore.getState().annotations.has("ann-live")).toBe(true);
  });
});
