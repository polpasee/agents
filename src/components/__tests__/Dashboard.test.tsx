import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
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

  describe("mobile main-agent badges", () => {
    it("renders nothing when no main agents are present", () => {
      const agents = new Map<string, AgentState>([
        ["a1", mockAgent({ id: "a1", agentType: "build" })],
      ]);
      useAgentStore.setState({ agents });
      const { container } = render(<Dashboard />);
      expect(container.querySelectorAll(".mobile-toggle-btn").length).toBe(0);
    });

    it("renders one badge per main with projectName(subCount) and tallies all descendants recursively", () => {
      // main → midA → leaf (3-level chain) plus a sibling leaf under main
      const main = mockAgent({
        id: "main",
        agentType: "main",
        sessionId: "s1",
        metadata: { projectName: "IPPortal2" },
      });
      const midA = mockAgent({ id: "midA", agentType: "build", parentId: "main" });
      const leaf = mockAgent({ id: "leaf", agentType: "build", parentId: "midA" });
      const sibling = mockAgent({ id: "sib", agentType: "test", parentId: "main" });
      const agents = new Map<string, AgentState>([
        ["main", main],
        ["midA", midA],
        ["leaf", leaf],
        ["sib", sibling],
      ]);
      useAgentStore.setState({ agents });

      const { container } = render(<Dashboard />);
      const buttons = container.querySelectorAll(".mobile-toggle-btn button");
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toContain("IPPortal2(3)");
    });

    it("falls back to sessionId then 'Unnamed' when projectName is absent", () => {
      const main1 = mockAgent({ id: "m1", agentType: "main", sessionId: "abc-123" });
      const main2 = mockAgent({ id: "m2", agentType: "main", sessionId: undefined });
      const agents = new Map<string, AgentState>([["m1", main1], ["m2", main2]]);
      useAgentStore.setState({ agents });

      const { container } = render(<Dashboard />);
      const labels = Array.from(container.querySelectorAll(".mobile-toggle-btn button"))
        .map((b) => b.textContent);
      expect(labels.some((l) => l?.includes("abc-123(0)"))).toBe(true);
      expect(labels.some((l) => l?.includes("Unnamed(0)"))).toBe(true);
    });

    it("invokes selectAgent when a badge is tapped", () => {
      const main = mockAgent({ id: "main", agentType: "main", sessionId: "s1" });
      useAgentStore.setState({ agents: new Map([["main", main]]) });

      const { container } = render(<Dashboard />);
      const button = container.querySelector(".mobile-toggle-btn button");
      expect(button).not.toBeNull();
      fireEvent.click(button!);
      expect(useAgentStore.getState().selectedAgentId).toBe("main");
    });

    it("does not infinite-loop on a parent-chain cycle", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // a → b → a forms a 2-cycle with no main at the root
      const a = mockAgent({ id: "a", agentType: "build", parentId: "b" });
      const b = mockAgent({ id: "b", agentType: "build", parentId: "a" });
      const main = mockAgent({ id: "main", agentType: "main", sessionId: "s1" });
      useAgentStore.setState({ agents: new Map([["a", a], ["b", b], ["main", main]]) });

      const { container } = render(<Dashboard />);
      const button = container.querySelector(".mobile-toggle-btn button");
      // Cycle agents must NOT contribute to the main's count.
      expect(button?.textContent).toContain("s1(0)");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("counts sub-agents whose parent was purged without logging a cycle warning", () => {
      // child references parentId "purged" which is NOT in the agents map.
      // The walk should stop silently (no warn) and child should NOT be counted
      // under any main (since root is unknown). No cycle warning must fire.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const main = mockAgent({ id: "main", agentType: "main", sessionId: "s1" });
      const child = mockAgent({ id: "child", agentType: "build", parentId: "purged" });
      useAgentStore.setState({ agents: new Map([["main", main], ["child", child]]) });

      const { container } = render(<Dashboard />);
      const button = container.querySelector(".mobile-toggle-btn button");
      // child's chain ends at a missing node, not a main — should not be counted
      expect(button?.textContent).toContain("s1(0)");
      // Must NOT have logged a cycle warning for a merely-missing parent
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("does not count agents whose chain root is not a rendered main", () => {
      // Orphan tree (no main at root) should be ignored.
      const orphanRoot = mockAgent({ id: "root", agentType: "build" });
      const orphanLeaf = mockAgent({ id: "leaf", agentType: "test", parentId: "root" });
      const main = mockAgent({ id: "main", agentType: "main", sessionId: "s1" });
      useAgentStore.setState({
        agents: new Map([["root", orphanRoot], ["leaf", orphanLeaf], ["main", main]]),
      });

      const { container } = render(<Dashboard />);
      const button = container.querySelector(".mobile-toggle-btn button");
      expect(button?.textContent).toContain("s1(0)");
    });
  });
});
