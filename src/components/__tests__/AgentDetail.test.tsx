import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentDetail } from "../AgentDetail";
import type { AgentState } from "@/lib/types";

const mockAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: "agent-1",
  agentType: "main",
  status: "running",
  task: "implement feature",
  toolCalls: [],
  inputTokens: 500,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  contextWindow: 1000000,
  startTime: Date.now(),
  ...overrides,
});

describe("AgentDetail", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      teams: new Map(),
      selectedAgentId: null,
      logEntries: new Map(),
      agentTypeBudgets: {},
      agentDiffs: new Map(),
      annotations: new Map(),
    });
  });

  it("shows placeholder when no agent is selected", () => {
    render(<AgentDetail />);
    expect(screen.getByText("Select an agent to inspect")).toBeDefined();
  });

  it("shows agent info when an agent is selected", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", task: "implement feature", model: "claude-3" }));

    useAgentStore.setState({ agents, selectedAgentId: "a1" });
    render(<AgentDetail />);

    expect(screen.getByText("implement feature")).toBeDefined();
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.getByText("claude-3")).toBeDefined();
  });
});
