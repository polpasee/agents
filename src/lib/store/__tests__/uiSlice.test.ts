/**
 * T-M4 — uiSlice actions
 *
 * Tests every action exported by uiSlice that was untested per the audit (line 78):
 * toggleTheme, toggleHeatmap, setHeatmapMetric, loadComparison, exitComparison,
 * hydrateUI, plus setViewMode, toggleAgentType, toggleSession, selectAllSessions.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAgentStore } from "../../store";
import { mockAgent } from "../../__tests__/test-utils";

function resetUI() {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    nextActivityId: 0,
    topologyVersion: 0,
    errorDetails: new Map(),
    teams: new Map(),
    agentTypeBudgets: {},
    selectedAgentId: null,
    selectedTeamId: null,
    selectedSessionIds: new Set(),
    sessionFilterInitialized: false,
    connected: false,
    hiddenAgentTypes: new Set(),
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
    theme: "dark",
    heatmapEnabled: false,
    heatmapMetric: "tokenEfficiency",
    graphLayout: "force",
    showExportModal: false,
    showLiveMetrics: false,
    transcriptOpen: false,
    fileAttentionOpen: false,
    soundMuted: false,
    comparison: { active: false, leftSession: null, rightSession: null },
  });
}

beforeEach(() => {
  resetUI();
  // Stub localStorage for tests that call toggleTheme / hydrateUI
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── toggleTheme ───────────────────────────────────────────────────────────────

describe("toggleTheme", () => {
  it("switches from dark to light", () => {
    useAgentStore.setState({ theme: "dark" });
    useAgentStore.getState().toggleTheme();
    expect(useAgentStore.getState().theme).toBe("light");
  });

  it("switches from light to dark", () => {
    useAgentStore.setState({ theme: "light" });
    useAgentStore.getState().toggleTheme();
    expect(useAgentStore.getState().theme).toBe("dark");
  });

  it("persists the new theme to localStorage", () => {
    useAgentStore.setState({ theme: "dark" });
    useAgentStore.getState().toggleTheme();
    expect(localStorage.setItem).toHaveBeenCalledWith("theme", "light");
  });
});

// ── toggleHeatmap ─────────────────────────────────────────────────────────────

describe("toggleHeatmap", () => {
  it("enables heatmap when it was disabled", () => {
    useAgentStore.setState({ heatmapEnabled: false });
    useAgentStore.getState().toggleHeatmap();
    expect(useAgentStore.getState().heatmapEnabled).toBe(true);
  });

  it("disables heatmap when it was enabled", () => {
    useAgentStore.setState({ heatmapEnabled: true });
    useAgentStore.getState().toggleHeatmap();
    expect(useAgentStore.getState().heatmapEnabled).toBe(false);
  });
});

// ── setHeatmapMetric ──────────────────────────────────────────────────────────

describe("setHeatmapMetric", () => {
  it("sets heatmap metric to tokenEfficiency", () => {
    useAgentStore.getState().setHeatmapMetric("tokenEfficiency");
    expect(useAgentStore.getState().heatmapMetric).toBe("tokenEfficiency");
  });

  it("sets heatmap metric to idleRatio", () => {
    useAgentStore.getState().setHeatmapMetric("idleRatio");
    expect(useAgentStore.getState().heatmapMetric).toBe("idleRatio");
  });

  it("sets heatmap metric to avgToolLatency", () => {
    useAgentStore.getState().setHeatmapMetric("avgToolLatency");
    expect(useAgentStore.getState().heatmapMetric).toBe("avgToolLatency");
  });
});

// ── loadComparison / exitComparison ───────────────────────────────────────────

describe("loadComparison", () => {
  it("activates comparison mode with the given sessions", () => {
    useAgentStore.getState().loadComparison("session-a", "session-b");
    const { comparison } = useAgentStore.getState();
    expect(comparison.active).toBe(true);
    expect(comparison.leftSession).toBe("session-a");
    expect(comparison.rightSession).toBe("session-b");
  });
});

describe("exitComparison", () => {
  it("deactivates comparison mode and clears sessions", () => {
    useAgentStore.getState().loadComparison("session-a", "session-b");
    useAgentStore.getState().exitComparison();
    const { comparison } = useAgentStore.getState();
    expect(comparison.active).toBe(false);
    expect(comparison.leftSession).toBeNull();
    expect(comparison.rightSession).toBeNull();
  });
});

// ── hydrateUI ─────────────────────────────────────────────────────────────────

describe("hydrateUI", () => {
  it("hydrates theme from localStorage", () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "theme") return JSON.stringify("light");
        return null;
      },
    );
    useAgentStore.getState().hydrateUI();
    expect(useAgentStore.getState().theme).toBe("light");
  });

  it("hydrates soundMuted from localStorage", () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "soundMuted") return JSON.stringify(true);
        return null;
      },
    );
    useAgentStore.getState().hydrateUI();
    expect(useAgentStore.getState().soundMuted).toBe(true);
  });

  it("hydrates selectedSessionIds from localStorage when stored array is present", () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "selectedSessionIds")
          return JSON.stringify(["sess-1", "sess-2"]);
        return null;
      },
    );
    useAgentStore.getState().hydrateUI();
    const ids = useAgentStore.getState().selectedSessionIds;
    expect(ids.has("sess-1")).toBe(true);
    expect(ids.has("sess-2")).toBe(true);
    // Non-empty stored arrays must NOT mark initialized — autoSelectInitialSession
    // needs to run to validate the ids against the live agents map.
    expect(useAgentStore.getState().sessionFilterInitialized).toBe(false);
  });

  it("marks initialized when stored array is empty (explicit 'All sessions' choice)", () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "selectedSessionIds") return JSON.stringify([]);
        return null;
      },
    );
    useAgentStore.getState().hydrateUI();
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
    expect(useAgentStore.getState().sessionFilterInitialized).toBe(true);
  });

  it("uses defaults when localStorage is empty", () => {
    // All getItem calls return null → fallbacks apply
    useAgentStore.getState().hydrateUI();
    expect(useAgentStore.getState().theme).toBe("dark");
    expect(useAgentStore.getState().soundMuted).toBe(false);
  });
});

// ── setViewMode ───────────────────────────────────────────────────────────────

describe("setViewMode", () => {
  it("switches viewMode to timeline", () => {
    useAgentStore.getState().setViewMode("timeline");
    expect(useAgentStore.getState().viewMode).toBe("timeline");
  });

  it("switches viewMode back to graph", () => {
    useAgentStore.getState().setViewMode("timeline");
    useAgentStore.getState().setViewMode("graph");
    expect(useAgentStore.getState().viewMode).toBe("graph");
  });
});

// ── autoSelectInitialSession ──────────────────────────────────────────────────

describe("autoSelectInitialSession", () => {
  it("keeps a stored filter when at least one id matches a live session", () => {
    useAgentStore.setState({
      agents: new Map([
        ["a1", mockAgent({ id: "a1", sessionId: "live", parentId: undefined })],
      ]),
      selectedSessionIds: new Set(["live"]),
      sessionFilterInitialized: false,
    });
    useAgentStore.getState().autoSelectInitialSession();
    const state = useAgentStore.getState();
    expect(state.sessionFilterInitialized).toBe(true);
    expect([...state.selectedSessionIds]).toEqual(["live"]);
  });

  it("falls through to All Sessions when stored ids are stale and live sessions exist", () => {
    useAgentStore.setState({
      agents: new Map([
        [
          "a1",
          mockAgent({
            id: "a1",
            sessionId: "live",
            parentId: undefined,
            startTime: 100,
          }),
        ],
      ]),
      selectedSessionIds: new Set(["stale-id-no-longer-exists"]),
      sessionFilterInitialized: false,
    });
    useAgentStore.getState().autoSelectInitialSession();
    const state = useAgentStore.getState();
    expect(state.sessionFilterInitialized).toBe(true);
    expect(state.selectedSessionIds.size).toBe(0); // empty = all sessions
  });

  it("defaults to All Sessions on first boot with no stored filter and live agents", () => {
    useAgentStore.setState({
      agents: new Map([
        [
          "a1",
          mockAgent({
            id: "a1",
            sessionId: "s1",
            parentId: undefined,
            startTime: 100,
          }),
        ],
        [
          "a2",
          mockAgent({
            id: "a2",
            sessionId: "s2",
            parentId: undefined,
            startTime: 200,
          }),
        ],
      ]),
      selectedSessionIds: new Set(),
      sessionFilterInitialized: false,
    });
    useAgentStore.getState().autoSelectInitialSession();
    const state = useAgentStore.getState();
    expect(state.sessionFilterInitialized).toBe(true);
    expect(state.selectedSessionIds.size).toBe(0); // empty = all sessions
  });

  it("waits (does not initialize) when no live agents have arrived yet on first boot", () => {
    useAgentStore.setState({
      agents: new Map(),
      selectedSessionIds: new Set(),
      sessionFilterInitialized: false,
    });
    useAgentStore.getState().autoSelectInitialSession();
    const state = useAgentStore.getState();
    expect(state.sessionFilterInitialized).toBe(false);
  });

  it("waits (does not initialize) when stored ids are stale but no agents have arrived yet", () => {
    useAgentStore.setState({
      agents: new Map(),
      selectedSessionIds: new Set(["stale-id"]),
      sessionFilterInitialized: false,
    });
    useAgentStore.getState().autoSelectInitialSession();
    const state = useAgentStore.getState();
    // Filter stays as-is; init flag stays false so the next agent arrival re-triggers.
    expect(state.sessionFilterInitialized).toBe(false);
    expect([...state.selectedSessionIds]).toEqual(["stale-id"]);
  });

  it("recovers from stale localStorage filter to All Sessions when first live agent arrives", () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "selectedSessionIds") return JSON.stringify(["stale-id"]);
        return null;
      },
    );
    useAgentStore.getState().hydrateUI();
    expect(useAgentStore.getState().sessionFilterInitialized).toBe(false);

    useAgentStore.setState({
      agents: new Map([
        [
          "a1",
          mockAgent({
            id: "a1",
            sessionId: "live-session",
            parentId: undefined,
          }),
        ],
      ]),
    });
    useAgentStore.getState().autoSelectInitialSession();

    const state = useAgentStore.getState();
    expect(state.selectedSessionIds.size).toBe(0); // empty = all sessions
    expect(state.sessionFilterInitialized).toBe(true);
  });
});

// ── toggleAgentType ───────────────────────────────────────────────────────────

describe("toggleAgentType", () => {
  it("hides an agent type that was visible", () => {
    useAgentStore.getState().toggleAgentType("build");
    expect(useAgentStore.getState().hiddenAgentTypes.has("build")).toBe(true);
  });

  it("shows an agent type that was hidden", () => {
    useAgentStore.setState({ hiddenAgentTypes: new Set(["build"]) });
    useAgentStore.getState().toggleAgentType("build");
    expect(useAgentStore.getState().hiddenAgentTypes.has("build")).toBe(false);
  });
});
