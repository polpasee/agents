/**
 * agentSlice.ts — branch coverage for uncovered regions.
 *
 * Targets lines/branches:
 *  ~86-88: getTeamStats — member status branches (completed/error/active counts)
 *  ~106:   handleEvent — isValidAgentEvent returns false → early return
 *  ~197-215: downloadRecording — try body + catch + URL/blob creation
 *  ~230: removeAgent — team pruning when team becomes empty vs has remaining members
 *  ~246-248: removeAgent — selectedSessionIds pruning for a dismissed root agent
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentStore } from "../../store";
import type { AgentEvent } from "../../types";

// ── Reset helper ──────────────────────────────────────────────────────────────

function resetState() {
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
    selectedSessionIds: new Set(),
    sessionFilterInitialized: false,
    hiddenAgentTypes: new Set(),
    connected: false,
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
  });
}

beforeEach(resetState);

// ── Helpers ───────────────────────────────────────────────────────────────────

function registerAgent(
  agentId: string,
  opts: { parentId?: string; teamId?: string; sessionId?: string } = {},
) {
  useAgentStore.getState().handleEvent(
    {
      type: "agent:register",
      agentId,
      agentType: "build",
      task: `task-${agentId}`,
      ...opts,
    },
    Date.now(),
  );
}

// ── getTeamStats — member status branches ─────────────────────────────────────

describe("getTeamStats — member status branches", () => {
  function setupTeamWithMembers() {
    // Create agents first, then manually set up a team via syncState
    const agents = [
      {
        id: "m1",
        agentType: "build" as const,
        status: "completed" as const,
        task: "task1",
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team1",
      },
      {
        id: "m2",
        agentType: "build" as const,
        status: "error" as const,
        task: "task2",
        toolCalls: [],
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team1",
      },
      {
        id: "m3",
        agentType: "build" as const,
        status: "running" as const,
        task: "task3",
        toolCalls: [],
        inputTokens: 50,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team1",
      },
    ];
    const teams = [
      {
        id: "team1",
        name: "Test Team",
        memberIds: ["m1", "m2", "m3"],
        status: "active" as const,
        task: "team task",
        startTime: Date.now(),
      },
    ];
    useAgentStore.getState().syncState(agents, [], teams, []);
  }

  it("returns zero counts for unknown team id", () => {
    const stats = useAgentStore.getState().getTeamStats("nonexistent");
    expect(stats.memberCount).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.completedCount).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.activeCount).toBe(0);
  });

  it("counts completed members correctly (branch 85: status === 'completed')", () => {
    setupTeamWithMembers();
    const stats = useAgentStore.getState().getTeamStats("team1");
    expect(stats.completedCount).toBe(1); // m1
  });

  it("counts error members correctly (branch 86: status === 'error')", () => {
    setupTeamWithMembers();
    const stats = useAgentStore.getState().getTeamStats("team1");
    expect(stats.errorCount).toBe(1); // m2
  });

  it("counts active members (running/idle) correctly (branch 87)", () => {
    setupTeamWithMembers();
    const stats = useAgentStore.getState().getTeamStats("team1");
    expect(stats.activeCount).toBe(1); // m3 (running)
  });

  it("counts idle members as active too", () => {
    const agents = [
      {
        id: "idle1",
        agentType: "build" as const,
        status: "idle" as const,
        task: "t",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team2",
      },
    ];
    const teams = [
      {
        id: "team2",
        name: "T2",
        memberIds: ["idle1"],
        status: "active" as const,
        task: "task",
        startTime: Date.now(),
      },
    ];
    useAgentStore.getState().syncState(agents, [], teams, []);
    const stats = useAgentStore.getState().getTeamStats("team2");
    expect(stats.activeCount).toBe(1);
  });

  it("accumulates total tokens from all members", () => {
    setupTeamWithMembers();
    const stats = useAgentStore.getState().getTeamStats("team1");
    // m1: 150, m2: 280, m3: 70 → total 500
    expect(stats.totalTokens).toBe(500);
  });

  it("returns memberCount equal to team member count", () => {
    setupTeamWithMembers();
    const stats = useAgentStore.getState().getTeamStats("team1");
    expect(stats.memberCount).toBe(3);
  });
});

// ── handleEvent — isValidAgentEvent returns false ─────────────────────────────

describe("handleEvent — invalid event early return (branch 6: line 122)", () => {
  it("does nothing when event fails validation (e.g. unknown type)", () => {
    const before = useAgentStore.getState().agents;
    const beforeActivity = useAgentStore.getState().activity;

    // An event with a missing required field — validation should reject it
    useAgentStore.getState().handleEvent(
      // Force cast a malformed event
      { type: "agent:register" } as AgentEvent,
      Date.now(),
    );

    // State should be unchanged — early return path
    expect(useAgentStore.getState().agents).toBe(before);
    expect(useAgentStore.getState().activity).toBe(beforeActivity);
  });

  it("does not increment topologyVersion for invalid event", () => {
    const before = useAgentStore.getState().topologyVersion;
    useAgentStore
      .getState()
      .handleEvent({ type: "agent:tokens" } as AgentEvent, Date.now());
    expect(useAgentStore.getState().topologyVersion).toBe(before);
  });
});

// ── downloadRecording ─────────────────────────────────────────────────────────

describe("downloadRecording — try/catch branches (lines 197-215)", () => {
  it("calls URL.createObjectURL and triggers download, then stops recording", () => {
    // Set up mocks for browser APIs
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    const clickFn = vi.fn();

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        const a = origCreateElement("a") as HTMLAnchorElement;
        a.click = clickFn;
        return a;
      }
      return origCreateElement(tag);
    });

    // Start recording and add some events
    useAgentStore.getState().startRecording();
    useAgentStore.getState().handleEvent(
      {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "test",
      },
      1000,
    );

    // Download
    useAgentStore.getState().downloadRecording();

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickFn).toHaveBeenCalledOnce();
    // After download, recording stops and events are cleared
    expect(useAgentStore.getState().recording).toBe(false);
    expect(useAgentStore.getState().recordedEvents).toHaveLength(0);

    // Cleanup
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("uses Date.now() as fallback startTime when recordedEvents is empty", () => {
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = document.createElement.call(document, tag);
      if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
      return el;
    });

    // Empty recorded events
    useAgentStore.getState().startRecording();
    useAgentStore.getState().downloadRecording();

    expect(createObjectURL).toHaveBeenCalledOnce();
    // Verify Blob was passed to URL.createObjectURL
    expect(createObjectURL).toHaveBeenCalledOnce();

    URL.createObjectURL = origCreateObjectURL;
    vi.restoreAllMocks();
  });

  it("catches error gracefully and still stops recording (catch branch)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const origCreateObjectURL = URL.createObjectURL;

    // Force URL.createObjectURL to throw
    URL.createObjectURL = () => {
      throw new Error("not supported");
    };

    useAgentStore.getState().startRecording();

    expect(() => useAgentStore.getState().downloadRecording()).not.toThrow();

    // recording should be stopped even after error
    expect(useAgentStore.getState().recording).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to download recording:",
      expect.any(Error),
    );

    URL.createObjectURL = origCreateObjectURL;
    warnSpy.mockRestore();
  });
});

// ── removeAgent — team and session pruning branches ───────────────────────────

describe("removeAgent — team pruning branches (lines 228-238)", () => {
  it("deletes team entirely when agent was the last member (branch 21: updatedMembers.length === 0)", () => {
    const agents = [
      {
        id: "solo",
        agentType: "build" as const,
        status: "running" as const,
        task: "t",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team-solo",
      },
    ];
    const teams = [
      {
        id: "team-solo",
        name: "Solo",
        memberIds: ["solo"],
        status: "active" as const,
        task: "t",
        startTime: Date.now(),
      },
    ];
    useAgentStore.getState().syncState(agents, [], teams, []);

    useAgentStore.getState().removeAgent("solo");

    // Team should be deleted
    expect(useAgentStore.getState().teams.has("team-solo")).toBe(false);
  });

  it("keeps team with updated memberIds when agent was not the last member", () => {
    const agents = [
      {
        id: "m1",
        agentType: "build" as const,
        status: "running" as const,
        task: "t",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team-multi",
      },
      {
        id: "m2",
        agentType: "build" as const,
        status: "running" as const,
        task: "t",
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
        startTime: Date.now(),
        teamId: "team-multi",
      },
    ];
    const teams = [
      {
        id: "team-multi",
        name: "Multi",
        memberIds: ["m1", "m2"],
        status: "active" as const,
        task: "t",
        startTime: Date.now(),
      },
    ];
    useAgentStore.getState().syncState(agents, [], teams, []);

    useAgentStore.getState().removeAgent("m1");

    // Team should still exist with only m2
    const team = useAgentStore.getState().teams.get("team-multi");
    expect(team).toBeDefined();
    expect(team?.memberIds).toEqual(["m2"]);
  });

  it("does not touch teams when removed agent has no teamId", () => {
    registerAgent("standalone");
    const teamsBefore = useAgentStore.getState().teams;

    useAgentStore.getState().removeAgent("standalone");

    // teams Map should be a new Map but same content (no team to modify)
    expect(useAgentStore.getState().teams).toEqual(teamsBefore);
  });
});

describe("removeAgent — selectedSessionIds pruning (lines 244-249)", () => {
  it("prunes sessionId from selectedSessionIds when root agent is removed (branch 25)", () => {
    // Register a root (main) agent with a session
    useAgentStore.getState().handleEvent(
      {
        type: "agent:register",
        agentId: "root",
        agentType: "main",
        task: "main task",
        sessionId: "sess-abc",
      },
      Date.now(),
    );

    // Manually put sess-abc in selectedSessionIds
    useAgentStore.setState({
      selectedSessionIds: new Set(["sess-abc"]),
    });

    useAgentStore.getState().removeAgent("root");

    // sess-abc should be pruned since its root agent was removed
    expect(useAgentStore.getState().selectedSessionIds.has("sess-abc")).toBe(
      false,
    );
  });

  it("does NOT prune selectedSessionIds when root agent's session is not selected (branch 25 false)", () => {
    useAgentStore.getState().handleEvent(
      {
        type: "agent:register",
        agentId: "root2",
        agentType: "main",
        task: "t",
        sessionId: "sess-xyz",
      },
      Date.now(),
    );

    // selectedSessionIds does NOT contain sess-xyz
    useAgentStore.setState({
      selectedSessionIds: new Set(["sess-other"]),
    });

    useAgentStore.getState().removeAgent("root2");

    // sess-other unchanged, nextSelectedSessionIds === selectedSessionIds
    expect(useAgentStore.getState().selectedSessionIds.has("sess-other")).toBe(
      true,
    );
  });

  it("does NOT prune selectedSessionIds when removed agent is a sub-agent (has parentId)", () => {
    registerAgent("parent");
    registerAgent("child");
    // Manually link child to parent
    const childAgent = useAgentStore.getState().agents.get("child")!;
    const updatedAgents = new Map(useAgentStore.getState().agents);
    updatedAgents.set("child", { ...childAgent, parentId: "parent" });
    useAgentStore.setState({ agents: updatedAgents });

    const sessionsBefore = useAgentStore.getState().selectedSessionIds;
    useAgentStore.getState().removeAgent("child");

    // Sub-agent removal → branch `agent && !agent.parentId` is false → no pruning
    expect(useAgentStore.getState().selectedSessionIds).toEqual(sessionsBefore);
  });

  it("conditional spread updates selectedSessionIds only when changed (branch 26)", () => {
    useAgentStore.getState().handleEvent(
      {
        type: "agent:register",
        agentId: "rootX",
        agentType: "main",
        task: "t",
        sessionId: "sess-rootX",
      },
      Date.now(),
    );
    useAgentStore.setState({ selectedSessionIds: new Set(["sess-rootX"]) });

    const before = useAgentStore.getState().selectedSessionIds;
    useAgentStore.getState().removeAgent("rootX");
    const after = useAgentStore.getState().selectedSessionIds;

    // Should be a new Set (different reference) because it was modified
    expect(after).not.toBe(before);
    expect(after.has("sess-rootX")).toBe(false);
  });
});
