import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { mockAgent } from "@/lib/__tests__/test-utils";
import type { AgentState } from "@/lib/types";

// Mock hooks that have side effects (WebSocket, sound, etc.)
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => {},
  sendWsMessage: vi.fn(),
}));
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
vi.mock("../Timeline", () => ({
  Timeline: () => <div data-testid="timeline">Timeline</div>,
}));
vi.mock("../LiveMetrics", () => ({
  LiveMetrics: () => null,
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
      viewMode: "graph",
      recording: false,
      showLiveMetrics: false,
      theme: "dark",
      teams: new Map(),
      selectedTeamId: null,
      hiddenAgentTypes: new Set(),
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
});
