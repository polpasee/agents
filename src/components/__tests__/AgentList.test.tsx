import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentList } from "../AgentList";
import type { AgentState } from "@/lib/types";

const mockAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: "agent-1",
  agentType: "main",
  status: "running",
  task: "test task",
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  contextWindow: 1000000,
  startTime: Date.now(),
  ...overrides,
});

describe("AgentList", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      teams: new Map(),
      selectedTeamId: null,
    });
  });

  it("shows 'No agents connected' when empty", () => {
    render(<AgentList />);
    expect(screen.getByText("No agents connected")).toBeDefined();
  });

  it("renders agent rows when agents exist", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", task: "Write tests" }));
    agents.set("a2", mockAgent({ id: "a2", agentType: "build", task: "Build project" }));

    useAgentStore.setState({ agents });
    render(<AgentList />);

    expect(screen.getByText("Agents (2)")).toBeDefined();
    expect(screen.getByText("Write tests")).toBeDefined();
    expect(screen.getByText("Build project")).toBeDefined();
  });
});
