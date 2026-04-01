import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { TopBar } from "../TopBar";
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

describe("TopBar", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      connected: false,
      selectedSessionIds: new Set(),
      viewMode: "graph",
      recording: false,
      showLiveMetrics: false,
      theme: "dark",
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
    });
  });

  it("renders agent count stats", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", status: "running" }));
    agents.set("a2", mockAgent({ id: "a2", status: "completed" }));
    agents.set("a3", mockAgent({ id: "a3", status: "error" }));

    useAgentStore.setState({ agents, connected: true });
    render(<TopBar />);

    // Stats are rendered as "LABEL: value" spans
    expect(screen.getByText("AGENTS:")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("ACTIVE:")).toBeDefined();
    expect(screen.getByText("DONE:")).toBeDefined();
    expect(screen.getByText("ERRORS:")).toBeDefined();
  });

  it("shows DISCONNECTED when not connected", () => {
    useAgentStore.setState({ connected: false });
    render(<TopBar />);
    expect(screen.getByText("DISCONNECTED")).toBeDefined();
  });

  it("shows AGENT MONITOR title", () => {
    render(<TopBar />);
    expect(screen.getByText("AGENT MONITOR")).toBeDefined();
  });
});
