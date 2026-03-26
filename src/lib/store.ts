import { create } from "zustand";
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  ToolCallEntry,
} from "./types";
import { ACTIVITY_MAX_ENTRIES, TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW } from "./config";

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
  recording: boolean;
  recordedEvents: Array<{ timestamp: number; event: AgentEvent }>;
  startRecording: () => void;
  downloadRecording: () => void;
  viewMode: "graph" | "timeline";
  setViewMode: (mode: "graph" | "timeline") => void;
  hiddenAgentTypes: Set<string>;
  toggleAgentType: (type: string) => void;
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
    const { agents, edges, activity, recording, recordedEvents } = get();
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
          contextWindow: DEFAULT_CONTEXT_WINDOW,
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
          const toolCalls = [...agent.toolCalls, entry].slice(-TOOL_CALLS_MAX_PER_AGENT);
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
      case "agent:message":
        // Message events are recorded in activity log but don't modify agent state
        break;
    }

    const newActivity = [
      ...activity,
      { id: `act-${++activityCounter}`, timestamp, event },
    ].slice(-ACTIVITY_MAX_ENTRIES);

    // recording/recordedEvents already destructured above
    set({
      agents: newAgents,
      edges: newEdges,
      activity: newActivity,
      ...(recording ? { recordedEvents: [...recordedEvents, { timestamp, event }] } : {}),
    });
  },

  recording: false,
  recordedEvents: [],
  startRecording: () => set({ recording: true, recordedEvents: [] }),
  downloadRecording: () => {
    try {
      const { recordedEvents } = get();
      const session = {
        startTime: recordedEvents[0]?.timestamp ?? Date.now(),
        events: recordedEvents,
      };
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agent-session-${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn("Failed to download recording:", err);
    }
    set({ recording: false, recordedEvents: [] });
  },

  viewMode: "graph" as "graph" | "timeline",
  setViewMode: (mode) => set({ viewMode: mode }),

  hiddenAgentTypes: new Set(),
  toggleAgentType: (type) => {
    const { hiddenAgentTypes } = get();
    const next = new Set(hiddenAgentTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    set({ hiddenAgentTypes: next });
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
