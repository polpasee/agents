import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { mockAgent } from "@/lib/__tests__/test-utils";
import type { AgentState } from "@/lib/types";

// Mock hooks that have side effects (WebSocket, sound, etc.)
vi.mock("@/hooks/useEventStream", () => ({ useEventStream: vi.fn() }));
vi.mock("@/hooks/useReplay", () => ({ useReplay: () => {} }));
vi.mock("@/hooks/useSoundNotifications", () => ({ useSoundNotifications: () => {} }));
vi.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => {} }));
vi.mock("@/hooks/useMetricSampler", () => ({ useMetricSampler: () => {} }));

// Mock D3 components that use canvas/SVG
vi.mock("../AgentGraph", () => ({
  AgentGraph: () => <div data-testid="agent-graph">AgentGraph</div>,
}));
vi.mock("../MiniMap", () => ({
  MiniMap: () => <div data-testid="mini-map">MiniMap</div>,
}));
vi.mock("../CostProjection", () => ({
  CostProjection: () => null,
}));

import { Dashboard } from "../Dashboard";

describe("Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      connected: false,
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      sessionFilterInitialized: true, // skip auto-pick effect during tests
      viewMode: "graph",
      recording: false,
      showLiveMetrics: false,
      theme: "dark",
      teams: new Map(),
      selectedTeamId: null,
      hiddenAgentTypes: new Set(),
      transcriptOpen: false,
      fileAttentionOpen: false,
      heatmapEnabled: false,
      heatmapMetric: "tokenEfficiency",
      graphLayout: "force",
      soundMuted: false,
      logViewerAgentId: null,
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
      comparison: { active: false, leftSession: null, rightSession: null },
      errorDrillDownAgentId: null,
      showExportModal: false,
      diffViewerAgentId: null,
      agentTypeBudgets: {},
      budgetThreshold: null,
      metricHistory: [],
      agentDiffs: new Map(),
      errorDetails: new Map(),
    });
  });

  it("renders without crashing", () => {
    const { container } = render(<Dashboard />);
    expect(container.querySelector("#main-content")).toBeDefined();
  });

  it("auto-clears selectedAgentId when selected agent is no longer in filtered agents", async () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents, selectedAgentId: "a1" });

    render(<Dashboard />);
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");

    act(() => {
      useAgentStore.setState({ agents: new Map() });
    });

    await waitFor(() => {
      expect(useAgentStore.getState().selectedAgentId).toBeNull();
    });
  });

  it("auto-clears selectedAgentId when session filter excludes the agent", async () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", sessionId: "s1" }));
    useAgentStore.setState({ agents, selectedAgentId: "a1" });

    render(<Dashboard />);
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");

    act(() => {
      useAgentStore.setState({ selectedSessionIds: new Set(["s2"]) });
    });

    await waitFor(() => {
      expect(useAgentStore.getState().selectedAgentId).toBeNull();
    });
  });

  it("auto-clears selectedAgentId when hiddenAgentTypes excludes the agent", async () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", agentType: "build" }));
    useAgentStore.setState({ agents, selectedAgentId: "a1" });

    render(<Dashboard />);
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");

    act(() => {
      useAgentStore.setState({ hiddenAgentTypes: new Set(["build"]) });
    });

    await waitFor(() => {
      expect(useAgentStore.getState().selectedAgentId).toBeNull();
    });
  });

  it("preserves selectedAgentId when an unrelated state change occurs", async () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents, selectedAgentId: "a1" });

    render(<Dashboard />);
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");

    // Add an unrelated second agent — selection must remain intact.
    act(() => {
      const next = new Map(agents);
      next.set("a2", mockAgent({ id: "a2" }));
      useAgentStore.setState({ agents: next });
    });

    // Wait one render tick for effects to flush, then assert no clear.
    await waitFor(() => {
      expect(useAgentStore.getState().agents.size).toBe(2);
    });
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });

  it("preserves selection when filter restores the parent of a surviving sub-agent", async () => {
    // Parent's type is hidden, but child's type isn't. The type filter drops the
    // parent; the parent-restoration fallback in useFilteredAgents re-adds it
    // because the child still references it. Parent selection must survive.
    const parent = mockAgent({ id: "parent", agentType: "main" });
    const child = mockAgent({ id: "child", parentId: "parent", agentType: "build" });
    const agents = new Map<string, AgentState>([
      ["parent", parent],
      ["child", child],
    ]);
    useAgentStore.setState({ agents, selectedAgentId: "parent" });

    render(<Dashboard />);
    expect(useAgentStore.getState().selectedAgentId).toBe("parent");

    act(() => {
      useAgentStore.setState({ hiddenAgentTypes: new Set(["main"]) });
    });

    // After re-render, both parent and child are still in filteredAgents
    // (parent re-added via fallback). Selection holds.
    await waitFor(() => {
      expect(useAgentStore.getState().hiddenAgentTypes.has("main")).toBe(true);
    });
    expect(useAgentStore.getState().selectedAgentId).toBe("parent");
  });
});
