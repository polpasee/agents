import type { AgentState, TeamState, AgentType, AgentStatus, TeamStatus } from "../types";
import { useAgentStore } from "../store";

let agentCounter = 0;
let teamCounter = 0;

export function mockAgent(overrides: Partial<AgentState> = {}): AgentState {
  agentCounter++;
  return {
    id: `agent-${agentCounter}`,
    agentType: "build" as AgentType,
    status: "running" as AgentStatus,
    task: `Task ${agentCounter}`,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: Date.now(),
    ...overrides,
  };
}

export function mockTeam(overrides: Partial<TeamState> = {}): TeamState {
  teamCounter++;
  return {
    id: `team-${teamCounter}`,
    name: `Team ${teamCounter}`,
    memberIds: [],
    status: "active" as TeamStatus,
    task: `Team task ${teamCounter}`,
    startTime: Date.now(),
    ...overrides,
  };
}

/**
 * Reset the Zustand store to its initial state.
 * Call this in beforeEach/afterEach to isolate tests.
 */
export function resetStore(): void {
  const store = useAgentStore.getState();
  // Reset core state by syncing empty data
  store.syncState([], [], []);
  store.selectAgent(null);
  store.selectTeam(null);
  agentCounter = 0;
  teamCounter = 0;
}
