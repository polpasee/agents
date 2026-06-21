/**
 * AgentList — branch/interaction tests
 *
 * Covers:
 * - Multiple-session layout (session pills, "All Sessions" button)
 * - Team groups (expand/collapse, member listing)
 * - Dismiss session button (canDismiss = all idle/completed/error)
 * - selectAgent / selectTeam / toggleSession / selectAllSessions interactions
 * - Status label branch: running + lastTool → shows tool name
 * - shortModel() branch: claude-opus/sonnet/haiku
 * - Session label disambiguation (duplicate project names)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentList } from "../AgentList";
import type { AgentState, TeamState } from "@/lib/types";
import { mockAgent, mockTeam, resetStore } from "@/lib/__tests__/test-utils";

function makeIdleAgent(overrides: Partial<AgentState> = {}): AgentState {
  return mockAgent({ status: "idle", ...overrides });
}

function makeCompletedAgent(overrides: Partial<AgentState> = {}): AgentState {
  return mockAgent({ status: "completed", ...overrides });
}

describe("AgentList — branches", () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({
      agents: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      teams: new Map(),
      selectedTeamId: null,
      workflows: new Map(),
    });
  });

  // ── Team display ─────────────────────────────────────────────────────────────
  // For team groups to render, both members must be in the SAME session.
  // We achieve this by making a2 a child of a1 (parentId: "a1"), so they share
  // session root "a1" → single-session layout → SessionAgents renders → team shows.

  it("shows TEAM label for agents with a matching teamId", () => {
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Alpha Squad",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1" });
    const a2 = mockAgent({ id: "a2", teamId: "team-1", parentId: "a1" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["team-1", team]]),
    });

    render(<AgentList />);
    expect(screen.getByText("TEAM")).toBeDefined();
    expect(screen.getByText("Alpha Squad")).toBeDefined();
  });

  it("shows team member count in parentheses", () => {
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Beta",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1" });
    const a2 = mockAgent({ id: "a2", teamId: "team-1", parentId: "a1" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["team-1", team]]),
    });

    render(<AgentList />);
    // Shows the count of members in the rendered group (2)
    expect(screen.getByText("(2 members)")).toBeDefined();
  });

  it("shows team member tasks when team is selected (expanded)", () => {
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Gamma",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1", task: "do-alpha" });
    const a2 = mockAgent({
      id: "a2",
      teamId: "team-1",
      parentId: "a1",
      task: "do-beta",
    });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["team-1", team]]),
      selectedTeamId: "team-1",
    });

    render(<AgentList />);
    // When team is selected the members are shown
    expect(screen.getByText("do-alpha")).toBeDefined();
    expect(screen.getByText("do-beta")).toBeDefined();
  });

  it("does NOT show team member tasks when team is NOT selected (collapsed)", () => {
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Delta",
      memberIds: ["a1"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1", task: "hidden-task" });

    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      teams: new Map([["team-1", team]]),
      selectedTeamId: null, // not expanded
    });

    render(<AgentList />);
    expect(screen.queryByText("hidden-task")).toBeNull();
  });

  it("calls selectTeam with team id when team button is clicked", () => {
    const selectTeam = vi.fn();

    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Epsilon",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1" });
    const a2 = mockAgent({ id: "a2", teamId: "team-1", parentId: "a1" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["team-1", team]]),
      selectedTeamId: null,
      selectTeam,
    });

    render(<AgentList />);
    fireEvent.click(screen.getByText("Epsilon"));
    expect(selectTeam).toHaveBeenCalledWith("team-1");
  });

  it("calls selectTeam(null) when selected team button is clicked again (toggle off)", () => {
    const selectTeam = vi.fn();
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Zeta",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1" });
    const a2 = mockAgent({ id: "a2", teamId: "team-1", parentId: "a1" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      teams: new Map([["team-1", team]]),
      selectedTeamId: "team-1", // already selected
      selectTeam,
    });

    render(<AgentList />);
    fireEvent.click(screen.getByText("Zeta"));
    expect(selectTeam).toHaveBeenCalledWith(null);
  });

  it("shows '· N teams' in header when teams are present", () => {
    const team: TeamState = mockTeam({
      id: "t1",
      name: "T1",
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "t1" });

    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      teams: new Map([["t1", team]]),
    });

    render(<AgentList />);
    // Header contains "1 team"
    expect(screen.getByText(/1 team/)).toBeDefined();
  });

  // ── Status label branch ────────────────────────────────────────────────────

  it("shows lastTool name as status label when agent is running with tool calls", () => {
    const a1 = mockAgent({
      id: "a1",
      status: "running",
      toolCalls: [{ tool: "Bash", args: "ls", timestamp: Date.now() }],
    });

    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText("Bash")).toBeDefined();
  });

  it("shows 'completed' status label when agent is completed", () => {
    const a1 = makeCompletedAgent({ id: "a1" });
    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText("completed")).toBeDefined();
  });

  // ── shortModel branch ──────────────────────────────────────────────────────

  it("abbreviates claude-sonnet model to Sonnet", () => {
    const a1 = mockAgent({ id: "a1", model: "claude-sonnet-4" });
    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText(/Sonnet/)).toBeDefined();
  });

  it("abbreviates claude-opus model to Opus", () => {
    const a1 = mockAgent({ id: "a1", model: "claude-opus-4" });
    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText(/Opus/)).toBeDefined();
  });

  it("abbreviates claude-haiku model to Haiku", () => {
    const a1 = mockAgent({ id: "a1", model: "claude-haiku-3" });
    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText(/Haiku/)).toBeDefined();
  });

  it("shows full model name when it does not match claude-opus/sonnet/haiku", () => {
    const a1 = mockAgent({ id: "a1", model: "gpt-4o" });
    useAgentStore.setState({ agents: new Map([["a1", a1]]) });
    render(<AgentList />);
    expect(screen.getByText(/gpt-4o/)).toBeDefined();
  });

  // ── Multi-session layout ───────────────────────────────────────────────────

  it("renders 'All Sessions' button when there are multiple sessions", () => {
    // Two unrelated agents (no parentId) → two separate sessions
    const a1 = mockAgent({ id: "a1" });
    const a2 = mockAgent({ id: "a2" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
    });

    render(<AgentList />);
    expect(screen.getByText("All Sessions")).toBeDefined();
  });

  it("shows session count in header when multiple sessions exist", () => {
    const a1 = mockAgent({ id: "a1" });
    const a2 = mockAgent({ id: "a2" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
    });

    render(<AgentList />);
    expect(screen.getByText(/2 sessions/)).toBeDefined();
  });

  it("calls toggleSession when a session pill is clicked", () => {
    const toggleSession = vi.fn();
    const a1 = mockAgent({ id: "a1", task: "sess1-task" });
    const a2 = mockAgent({ id: "a2", task: "sess2-task" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      toggleSession,
    });

    render(<AgentList />);
    // The session pills have aria-pressed; click one of them (skip the "All Sessions" one)
    const buttons = screen.getAllByRole("button");
    // Find buttons that are session pill buttons (have aria-pressed but not title "Show all sessions")
    const sessionPillButtons = buttons.filter(
      (b) =>
        b.getAttribute("aria-pressed") !== null &&
        !b.getAttribute("title")?.includes("Show all"),
    );
    expect(sessionPillButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(sessionPillButtons[0]!);
    expect(toggleSession).toHaveBeenCalled();
  });

  it("calls selectAllSessions when 'All Sessions' button is clicked and not all active", () => {
    const selectAllSessions = vi.fn();
    const a1 = mockAgent({ id: "a1" });
    const a2 = mockAgent({ id: "a2" });

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      selectedSessionIds: new Set(["a1"]), // one session selected → not allActive
      selectAllSessions,
    });

    render(<AgentList />);
    fireEvent.click(screen.getByText("All Sessions"));
    expect(selectAllSessions).toHaveBeenCalled();
  });

  it("renders Dismiss button when all agents in session are idle/completed/error", () => {
    const a1 = makeIdleAgent({ id: "a1" });

    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      // Need two sessions to get into multi-session layout
    });

    // Add a second completed agent for multi-session layout
    const a2 = makeCompletedAgent({ id: "a2" });
    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
    });

    render(<AgentList />);
    // Dismiss button (✕) should be visible for the completed session
    const dismissButtons = screen.getAllByRole("button", {
      name: /Dismiss session/,
    });
    expect(dismissButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT render Dismiss button when an agent in the session is still running", () => {
    const a1 = mockAgent({ id: "a1", status: "running" });
    const a2 = makeCompletedAgent({ id: "a2" }); // second session

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
    });

    render(<AgentList />);
    // The running session should NOT have a dismiss button
    // At least one session (a2) is dismissable; a1's session should not be
    const allDismissButtons = screen.queryAllByRole("button", {
      name: /Dismiss session/,
    });
    // Only the completed session gets a dismiss button, not the running one
    // We can't deterministically know which one is shown first, but we know
    // the total ≤ 1 (only one is dismissable)
    expect(allDismissButtons.length).toBeLessThanOrEqual(1);
  });

  it("calls removeAgent for each agent when Dismiss is clicked", () => {
    const removeAgent = vi.fn();
    const a1 = makeCompletedAgent({ id: "a1" });
    const a2 = makeIdleAgent({ id: "a2" }); // different session

    useAgentStore.setState({
      agents: new Map([
        ["a1", a1],
        ["a2", a2],
      ]),
      removeAgent,
    });

    render(<AgentList />);
    const dismissButtons = screen.getAllByRole("button", {
      name: /Dismiss session/,
    });
    fireEvent.click(dismissButtons[0]!);
    expect(removeAgent).toHaveBeenCalled();
  });

  // ── selectAgent interaction ─────────────────────────────────────────────────

  it("calls selectAgent when an agent row is clicked", () => {
    const selectAgent = vi.fn();
    const a1 = mockAgent({ id: "a1", task: "click-me" });

    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectAgent,
    });

    render(<AgentList />);
    fireEvent.click(screen.getByText("click-me"));
    expect(selectAgent).toHaveBeenCalledWith("a1");
  });

  // ── Empty-state guard ───────────────────────────────────────────────────────

  it("shows 'No agents connected' when no agents and no session filter active", () => {
    render(<AgentList />);
    expect(screen.getByText("No agents connected")).toBeDefined();
  });

  it("does NOT show 'No agents connected' when selectedSessionIds has a value but agentList is empty", () => {
    // When a session is selected but has no filtered agents, we do NOT show the empty message
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedSessionIds: new Set(["a1"]),
      hiddenAgentTypes: new Set(["build" as import("@/lib/types").AgentType]), // hide the one agent
    });
    render(<AgentList />);
    // The empty-state div requires BOTH agentList.length === 0 AND selectedSessionIds.size === 0
    expect(screen.queryByText("No agents connected")).toBeNull();
  });
});
