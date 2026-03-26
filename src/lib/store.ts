import { create } from "zustand";
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  ToolCallEntry,
} from "./types";

interface AgentStore {
  agents: Map<string, AgentState>;
  edges: EdgeState[];
  activity: ActivityEntry[];
  selectedAgentId: string | null;
  selectedSessionId: string | null; // null = "All Sessions"
  connected: boolean;

  // Actions
  setConnected: (connected: boolean) => void;
  selectAgent: (id: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  syncState: (agents: AgentState[], edges: EdgeState[]) => void;
  handleEvent: (event: AgentEvent, timestamp: number) => void;
  removeAgent: (agentId: string) => void;
}

let activityCounter = 0;

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: new Map(),
  edges: [],
  activity: [],
  selectedAgentId: null,
  selectedSessionId: null,
  connected: false,

  setConnected: (connected) => set({ connected }),

  selectAgent: (id) => set({ selectedAgentId: id }),

  selectSession: (sessionId) => set({ selectedSessionId: sessionId, selectedAgentId: null }),

  syncState: (agentsList, edges) => {
    const agents = new Map<string, AgentState>();
    for (const agent of agentsList) {
      agents.set(agent.id, agent);
    }
    set({ agents, edges });
  },

  handleEvent: (event, timestamp) => {
    const { agents, edges, activity } = get();
    const newAgents = new Map(agents);
    let newEdges = edges;

    switch (event.type) {
      case "agent:register": {
        const agent: AgentState = {
          id: event.agentId,
          parentId: event.parentId,
          agentType: event.agentType,
          status: "running",
          task: event.task,
          sessionId: event.sessionId,
          slug: event.slug,
          model: event.model,
          toolCalls: [],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 1000000,
          startTime: timestamp,
          metadata: event.metadata,
        };
        newAgents.set(event.agentId, agent);
        if (event.parentId) {
          newEdges = [...edges, { source: event.parentId, target: event.agentId }];
        }
        break;
      }
      case "agent:status": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          newAgents.set(event.agentId, { ...agent, status: event.status });
        }
        break;
      }
      case "agent:tool_call": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          const entry: ToolCallEntry = {
            tool: event.tool,
            args: event.args,
            result: event.result,
            timestamp,
          };
          const toolCalls = [...agent.toolCalls, entry].slice(-20);
          newAgents.set(event.agentId, { ...agent, toolCalls });
        }
        break;
      }
      case "agent:tokens": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          newAgents.set(event.agentId, {
            ...agent,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheCreateTokens: event.cacheCreateTokens,
            contextWindow: event.contextWindow,
          });
        }
        break;
      }
      case "agent:complete": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          newAgents.set(event.agentId, {
            ...agent,
            status: "completed",
            duration: event.duration,
            summary: event.summary,
          });
        }
        break;
      }
    }

    const newActivity = [
      ...activity,
      { id: `act-${++activityCounter}`, timestamp, event },
    ].slice(-100);

    set({
      agents: newAgents,
      edges: newEdges,
      activity: newActivity,
    });
  },

  removeAgent: (agentId) => {
    const { agents, edges } = get();
    const newAgents = new Map(agents);
    newAgents.delete(agentId);
    const newEdges = edges.filter(
      (e) => e.source !== agentId && e.target !== agentId
    );
    set({ agents: newAgents, edges: newEdges });
  },
}));
