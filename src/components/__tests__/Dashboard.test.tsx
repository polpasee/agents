import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";

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
vi.mock("../GraphControls", () => ({
  GraphControls: () => <div data-testid="graph-controls">GraphControls</div>,
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
});
