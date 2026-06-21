/**
 * AgentDetail — branch/interaction tests
 *
 * Covers:
 * - TokenBudgetRow: null budget (hidden), ok/warning/critical colors, EXCEEDED flag
 * - EfficiencyDisplay: renders bars when agent selected
 * - Cache token section appears when cacheReadTokens > 0
 * - Summary section appears when agent.summary is set
 * - Slug row appears when agent.slug is set
 * - Team row appears when agent has a matching teamId
 * - Recent tools listed / empty state
 * - DIFFS button when agentDiffs has the agent
 * - openDiffViewer called on DIFFS click
 * - openErrorDrillDown called on VIEW ERROR click for error status agents
 * - Status "error" branch shows VIEW ERROR button
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentDetail } from "../AgentDetail";
import type { AgentState, TeamState } from "@/lib/types";
import { mockAgent, mockTeam, resetStore } from "@/lib/__tests__/test-utils";

describe("AgentDetail — branches", () => {
  beforeEach(() => {
    resetStore();
    useAgentStore.setState({
      agents: new Map(),
      teams: new Map(),
      selectedAgentId: null,
      logEntries: new Map(),
      agentTypeBudgets: {},
      agentDiffs: new Map(),
      annotations: new Map(),
      workflows: new Map(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Token budget ─────────────────────────────────────────────────────────────

  it("does NOT render TOKEN BUDGET row when no budget is configured for agent type", () => {
    const a1 = mockAgent({ id: "a1", agentType: "build" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentTypeBudgets: {}, // no budget for "build"
    });
    render(<AgentDetail />);
    expect(screen.queryByText("TOKEN BUDGET")).toBeNull();
  });

  it("renders TOKEN BUDGET row when a budget is configured for agent type", () => {
    const a1 = mockAgent({
      id: "a1",
      agentType: "build",
      inputTokens: 1000,
      outputTokens: 500,
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentTypeBudgets: { build: 10000 },
    });
    render(<AgentDetail />);
    expect(screen.getByText("TOKEN BUDGET")).toBeDefined();
  });

  it("shows EXCEEDED label when budgetExceeded is true", () => {
    const a1 = mockAgent({
      id: "a1",
      agentType: "build",
      inputTokens: 9000,
      outputTokens: 2000,
      budgetExceeded: true,
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentTypeBudgets: { build: 10000 },
    });
    render(<AgentDetail />);
    expect(screen.getByText("EXCEEDED")).toBeDefined();
  });

  it("does NOT show EXCEEDED label when budget is under limit", () => {
    const a1 = mockAgent({
      id: "a1",
      agentType: "build",
      inputTokens: 2000,
      outputTokens: 500,
      budgetExceeded: false,
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentTypeBudgets: { build: 100000 },
    });
    render(<AgentDetail />);
    expect(screen.queryByText("EXCEEDED")).toBeNull();
  });

  // ── Cache tokens section ──────────────────────────────────────────────────────

  it("shows cache read/write rows when cacheReadTokens > 0", () => {
    const a1 = mockAgent({
      id: "a1",
      cacheReadTokens: 500,
      cacheCreateTokens: 200,
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText(/cache read/)).toBeDefined();
    expect(screen.getByText(/cache write/)).toBeDefined();
  });

  it("does NOT show cache rows when cacheReadTokens and cacheCreateTokens are 0", () => {
    const a1 = mockAgent({
      id: "a1",
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText(/cache read/)).toBeNull();
  });

  // ── Summary section ───────────────────────────────────────────────────────────

  it("shows SUMMARY row when agent.summary is set", () => {
    const a1 = mockAgent({ id: "a1", summary: "All tests passed." });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("SUMMARY")).toBeDefined();
    expect(screen.getByText("All tests passed.")).toBeDefined();
  });

  it("does NOT show SUMMARY row when agent.summary is absent", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText("SUMMARY")).toBeNull();
  });

  // ── Slug row ─────────────────────────────────────────────────────────────────

  it("shows SLUG row when agent.slug is set", () => {
    const a1 = mockAgent({ id: "a1", slug: "my-project" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("SLUG")).toBeDefined();
    expect(screen.getByText("my-project")).toBeDefined();
  });

  it("does NOT show SLUG row when agent.slug is absent", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText("SLUG")).toBeNull();
  });

  // ── Team row ─────────────────────────────────────────────────────────────────

  it("shows TEAM row when agent has a matching teamId", () => {
    const team: TeamState = mockTeam({
      id: "team-1",
      name: "Bravo",
      memberIds: ["a1", "a2"],
      status: "active",
    });
    const a1 = mockAgent({ id: "a1", teamId: "team-1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      teams: new Map([["team-1", team]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("TEAM")).toBeDefined();
    expect(screen.getByText("Bravo")).toBeDefined();
    expect(screen.getByText("(2 members)")).toBeDefined();
  });

  it("does NOT show TEAM row when agent has no teamId", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText("TEAM")).toBeNull();
  });

  // ── Recent tools ──────────────────────────────────────────────────────────────

  it("shows 'No tool calls yet' when toolCalls is empty", () => {
    const a1 = mockAgent({ id: "a1", toolCalls: [] });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("No tool calls yet")).toBeDefined();
  });

  it("renders recent tool names when toolCalls are present", () => {
    const a1 = mockAgent({
      id: "a1",
      toolCalls: [
        { tool: "Read", args: "file.ts", timestamp: Date.now() },
        { tool: "Write", args: "out.ts", timestamp: Date.now() },
      ],
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Write")).toBeDefined();
  });

  it("shows tool args when present", () => {
    const a1 = mockAgent({
      id: "a1",
      toolCalls: [{ tool: "Bash", args: "ls -la", timestamp: Date.now() }],
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText(/ls -la/)).toBeDefined();
  });

  // ── DIFFS button ──────────────────────────────────────────────────────────────

  it("shows DIFFS button when agentDiffs has the agent", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentDiffs: new Map([["a1", []]]),
    });
    render(<AgentDetail />);
    expect(screen.getByText("DIFFS")).toBeDefined();
  });

  it("does NOT show DIFFS button when agentDiffs does not have the agent", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentDiffs: new Map(),
    });
    render(<AgentDetail />);
    expect(screen.queryByText("DIFFS")).toBeNull();
  });

  it("calls openDiffViewer when DIFFS button is clicked", () => {
    const openDiffViewer = vi.fn();
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      agentDiffs: new Map([["a1", []]]),
      openDiffViewer,
    });
    render(<AgentDetail />);
    fireEvent.click(screen.getByText("DIFFS"));
    expect(openDiffViewer).toHaveBeenCalledWith("a1");
  });

  // ── Error status ──────────────────────────────────────────────────────────────

  it("shows VIEW ERROR button when agent status is 'error'", () => {
    const a1 = mockAgent({ id: "a1", status: "error" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("VIEW ERROR")).toBeDefined();
  });

  it("does NOT show VIEW ERROR button when agent status is 'running'", () => {
    const a1 = mockAgent({ id: "a1", status: "running" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText("VIEW ERROR")).toBeNull();
  });

  it("calls openErrorDrillDown when VIEW ERROR button is clicked", () => {
    const openErrorDrillDown = vi.fn();
    const a1 = mockAgent({ id: "a1", status: "error" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
      openErrorDrillDown,
    });
    render(<AgentDetail />);
    fireEvent.click(screen.getByText("VIEW ERROR"));
    expect(openErrorDrillDown).toHaveBeenCalledWith("a1");
  });

  // ── Model row ─────────────────────────────────────────────────────────────────

  it("shows MODEL row when agent.model is set", () => {
    const a1 = mockAgent({ id: "a1", model: "claude-opus-4" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("MODEL")).toBeDefined();
    expect(screen.getByText("claude-opus-4")).toBeDefined();
  });

  it("does NOT show MODEL row when agent.model is absent", () => {
    const a1 = mockAgent({ id: "a1" });
    // Ensure no model field
    delete (a1 as Partial<AgentState>).model;
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.queryByText("MODEL")).toBeNull();
  });

  // ── Efficiency display ────────────────────────────────────────────────────────

  it("shows EFFICIENCY section for selected agent", () => {
    const a1 = mockAgent({ id: "a1" });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    expect(screen.getByText("EFFICIENCY")).toBeDefined();
    expect(screen.getByText("Token Eff.")).toBeDefined();
    expect(screen.getByText("Tool Success")).toBeDefined();
    expect(screen.getByText("Speed")).toBeDefined();
  });

  // ── Secondary label (wfLabel / workflowName / displayType) ─────────────────

  it("suppresses secondary label when it equals the agent type label", () => {
    // AGENT_LABELS["build"] = "BUILD", so if displayType = "BUILD" it should be hidden
    const a1 = mockAgent({
      id: "a1",
      agentType: "build",
      displayType: "BUILD",
    });
    useAgentStore.setState({
      agents: new Map([["a1", a1]]),
      selectedAgentId: "a1",
    });
    render(<AgentDetail />);
    // Should only appear once (as primary label), not duplicated as secondary
    const allBuild = screen.queryAllByText("BUILD");
    expect(allBuild.length).toBe(1);
  });
});
