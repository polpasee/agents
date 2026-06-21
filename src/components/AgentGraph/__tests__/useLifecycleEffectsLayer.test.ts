import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AgentState, ActivityEntry } from "@/lib/types";
import type { AgentGraphRefs, LifecycleEffect } from "../refs";
import type { SimNode, SimLink } from "@/lib/d3";

// ── Mocks — all factories must be self-contained (hoisted before imports) ─────

vi.mock("d3-selection", () => {
  const makeSel = (): Record<string, unknown> => ({
    attr: vi.fn().mockReturnThis(),
    empty: vi.fn(() => false),
    remove: vi.fn().mockReturnThis(),
    each: vi.fn().mockReturnThis(),
    select: vi.fn(() => makeSel()),
    selectAll: vi.fn(() => makeSel()),
    append: vi.fn(() => makeSel()),
    data: vi.fn(() => makeSel()),
    join: vi.fn(() => makeSel()),
    merge: vi.fn(() => makeSel()),
    enter: vi.fn(() => makeSel()),
    exit: vi.fn(() => ({ remove: vi.fn() })),
    on: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
  });
  return { select: vi.fn(() => makeSel()) };
});

vi.mock("@/lib/colors", () => ({
  agentColor: vi.fn(() => "#0f0"),
  UI: { text: { secondary: "#aaa" }, success: "#0f0", error: "#f00" },
}));

vi.mock("@/lib/config", () => ({
  GRAPH: { nodeRadius: 42 },
  getNodeRadius: vi.fn(() => 42),
}));

vi.mock("@/lib/d3", () => ({
  depthFactor: vi.fn(() => 1),
  hexPath: vi.fn(() => "M0,0"),
  renderNodeVisuals: vi.fn(),
  updateLinkVisuals: vi.fn(),
  bezierPath: vi.fn(),
  linkPath: vi.fn(),
  clusterHullPath: vi.fn(),
  clusterLabelAnchor: vi.fn(),
  agentDepth: vi.fn(() => 0),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { useLifecycleEffectsLayer } from "../useLifecycleEffectsLayer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeRef<T>(val: T): React.RefObject<T> {
  return { current: val } as React.RefObject<T>;
}

function makeMutableRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeSvg(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

function makeRefs(partial: Partial<AgentGraphRefs> = {}): AgentGraphRefs {
  return {
    svgRef: makeRef(makeSvg()),
    containerRef: makeRef(document.createElement("div")),
    simulationRef: makeMutableRef<
      import("d3-force").Simulation<SimNode, SimLink> | null
    >(null),
    nodesRef: makeMutableRef<SimNode[]>([]),
    linksRef: makeMutableRef<SimLink[]>([]),
    toolNodesRef: makeMutableRef<SimNode[]>([]),
    toolLinksRef: makeMutableRef<SimLink[]>([]),
    zoomRef: makeMutableRef(null),
    effectsRef: makeMutableRef<LifecycleEffect[]>([]),
    prevActivityLenRef: makeMutableRef(0),
    ...partial,
  };
}

function makeEntry(id: string, event: ActivityEntry["event"]): ActivityEntry {
  return { id, timestamp: Date.now(), event };
}

// ── Tests: push effect (activity → effectsRef) ─────────────────────────────────

describe("useLifecycleEffectsLayer — push effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not push any effect when activity is empty", () => {
    const refs = makeRefs();
    renderHook(() =>
      useLifecycleEffectsLayer(refs, { agents: new Map(), activity: [] }),
    );
    expect(refs.effectsRef.current).toHaveLength(0);
  });

  it("pushes a spawn effect on agent:register when node has a position", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 100, y: 200 } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
    });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "test",
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(1);
    expect(refs.effectsRef.current[0]?.type).toBe("spawn");
    expect(refs.effectsRef.current[0]?.x).toBe(100);
    expect(refs.effectsRef.current[0]?.y).toBe(200);
  });

  it("pushes a complete effect on agent:complete when node has a position", () => {
    const agent = makeAgent({ id: "a1", status: "completed" });
    const node: SimNode = { id: "a1", agent, x: 50, y: 75 } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
    });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:complete",
            agentId: "a1",
            duration: 5000,
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(1);
    expect(refs.effectsRef.current[0]?.type).toBe("complete");
  });

  it("pushes an error effect on agent:status with error status", () => {
    const agent = makeAgent({ id: "a1", status: "error" });
    const node: SimNode = { id: "a1", agent, x: 10, y: 20 } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
    });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:status",
            agentId: "a1",
            status: "error",
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(1);
    expect(refs.effectsRef.current[0]?.type).toBe("error");
  });

  it("does NOT push for agent:status with non-error status", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 10, y: 20 } as SimNode;
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
    });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:status",
            agentId: "a1",
            status: "running",
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(0);
  });

  it("does NOT push when node has no position (x/y undefined)", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent } as SimNode; // no x/y
    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
    });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "test",
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(0);
  });

  it("does NOT push when agentId is not in nodesRef", () => {
    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([]) });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map(),
        activity: [
          makeEntry("act-1", {
            type: "agent:complete",
            agentId: "ghost",
            duration: 1000,
          }),
        ],
      }),
    );

    expect(refs.effectsRef.current).toHaveLength(0);
  });

  it("does not re-push entries already processed (tracks by numeric id)", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 0, y: 0 } as SimNode;

    const entry = makeEntry("act-5", {
      type: "agent:register",
      agentId: "a1",
      agentType: "main",
      task: "t",
    });

    const refs = makeRefs({
      nodesRef: makeMutableRef<SimNode[]>([node]),
      prevActivityLenRef: makeMutableRef(0),
    });

    const { rerender } = renderHook(
      ({ activity }: { activity: ActivityEntry[] }) =>
        useLifecycleEffectsLayer(refs, {
          agents: new Map([["a1", agent]]),
          activity,
        }),
      { initialProps: { activity: [entry] } },
    );

    expect(refs.effectsRef.current).toHaveLength(1);

    // Re-render with the same activity — must not push again
    rerender({ activity: [entry] });
    expect(refs.effectsRef.current).toHaveLength(1);
  });

  it("pushes only NEW entries when activity grows", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 0, y: 0 } as SimNode;

    const entry1 = makeEntry("act-1", {
      type: "agent:register",
      agentId: "a1",
      agentType: "main",
      task: "t",
    });
    const entry2 = makeEntry("act-2", {
      type: "agent:complete",
      agentId: "a1",
      duration: 1000,
    });

    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([node]) });

    const { rerender } = renderHook(
      ({ activity }: { activity: ActivityEntry[] }) =>
        useLifecycleEffectsLayer(refs, {
          agents: new Map([["a1", agent]]),
          activity,
        }),
      { initialProps: { activity: [entry1] } },
    );

    expect(refs.effectsRef.current).toHaveLength(1);
    expect(refs.effectsRef.current[0]?.type).toBe("spawn");

    rerender({ activity: [entry1, entry2] });
    expect(refs.effectsRef.current).toHaveLength(2);
    expect(refs.effectsRef.current[1]?.type).toBe("complete");
  });

  it("error effect has duration 800ms; spawn/complete have 1000ms", () => {
    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 0, y: 0 } as SimNode;
    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([node]) });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
          makeEntry("act-2", {
            type: "agent:status",
            agentId: "a1",
            status: "error",
          }),
        ],
      }),
    );

    const spawn = refs.effectsRef.current.find((e) => e.type === "spawn");
    const error = refs.effectsRef.current.find((e) => e.type === "error");
    expect(spawn?.duration).toBe(1000);
    expect(error?.duration).toBe(800);
  });
});

// ── Tests: drain effect (RAF loop) ────────────────────────────────────────────

describe("useLifecycleEffectsLayer — drain effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls requestAnimationFrame when effectsRef has queued effects", () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(1);

    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 0, y: 0 } as SimNode;
    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([node]) });

    renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
      }),
    );

    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it("does NOT call requestAnimationFrame when effectsRef is empty", () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(1);

    const refs = makeRefs();
    renderHook(() =>
      useLifecycleEffectsLayer(refs, { agents: new Map(), activity: [] }),
    );

    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it("cancels the RAF loop on unmount", () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(42);

    const agent = makeAgent({ id: "a1" });
    const node: SimNode = { id: "a1", agent, x: 0, y: 0 } as SimNode;
    const refs = makeRefs({ nodesRef: makeMutableRef<SimNode[]>([node]) });

    const { unmount } = renderHook(() =>
      useLifecycleEffectsLayer(refs, {
        agents: new Map([["a1", agent]]),
        activity: [
          makeEntry("act-1", {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          }),
        ],
      }),
    );

    act(() => {
      unmount();
    });

    expect(cancelSpy).toHaveBeenCalledWith(42);
    cancelSpy.mockRestore();
  });

  it("expires finished effects from effectsRef inside the RAF tick", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(performance.now());
      return 1;
    });

    const refs = makeRefs();
    // Pre-seed an already-expired effect
    refs.effectsRef.current = [
      {
        x: 0,
        y: 0,
        color: "#fff",
        type: "spawn",
        startTime: Date.now() - 2000, // expired: duration=1000
        duration: 1000,
        effectRadius: 42,
      },
    ];

    renderHook(() =>
      useLifecycleEffectsLayer(refs, { agents: new Map(), activity: [] }),
    );

    expect(refs.effectsRef.current).toHaveLength(0);
  });
});
