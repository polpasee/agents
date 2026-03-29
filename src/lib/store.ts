import { create } from "zustand";
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  ToolCallEntry,
  TeamState,
  TeamStats,
} from "./types";
import { ACTIVITY_MAX_ENTRIES, TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW } from "./config";

interface AgentStore {
  agents: Map<string, AgentState>;
  edges: EdgeState[];
  activity: ActivityEntry[];
  selectedAgentId: string | null;
  selectedSessionId: string | null; // null = "All Sessions"
  connected: boolean;
  teams: Map<string, TeamState>;
  selectedTeamId: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  selectAgent: (id: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  selectTeam: (teamId: string | null) => void;
  getTeamStats: (teamId: string) => TeamStats;
  syncState: (agents: AgentState[], edges: EdgeState[], teams: TeamState[]) => void;
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
  teams: new Map(),
  selectedTeamId: null,

  setConnected: (connected) => set({ connected }),

  selectAgent: (id) => set({ selectedAgentId: id }),

  selectSession: (sessionId) => set({ selectedSessionId: sessionId, selectedAgentId: null }),

  selectTeam: (teamId) => set({ selectedTeamId: teamId }),

  getTeamStats: (teamId) => {
    const { agents, teams } = get();
    const team = teams.get(teamId);
    if (!team) return { totalTokens: 0, totalCost: 0, memberCount: 0, completedCount: 0, errorCount: 0, activeCount: 0 };
    const members = team.memberIds.map(id => agents.get(id)).filter(Boolean) as AgentState[];
    let totalTokens = 0;
    let completedCount = 0;
    let errorCount = 0;
    let activeCount = 0;
    for (const m of members) {
      totalTokens += m.inputTokens + m.outputTokens;
      if (m.status === "completed") completedCount++;
      else if (m.status === "error") errorCount++;
      else if (m.status === "running" || m.status === "idle") activeCount++;
    }
    return { totalTokens, totalCost: 0, memberCount: members.length, completedCount, errorCount, activeCount };
  },

  syncState: (agentsList, edges, teamsList) => {
    const agents = new Map<string, AgentState>();
    for (const agent of agentsList) {
      agents.set(agent.id, agent);
    }
    const teams = new Map<string, TeamState>();
    for (const team of teamsList) {
      teams.set(team.id, team);
    }
    set({ agents, edges, teams });
  },

  handleEvent: (event, timestamp) => {
    const { agents, edges, activity, recording, recordedEvents } = get();
    const newAgents = new Map(agents);
    let newEdges = edges;
    let newTeamsUpdate: Map<string, TeamState> | null = null;

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
          teamId: event.teamId,
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
        if (event.teamId) {
          const { teams } = get();
          const newTeams = new Map(teams);
          let team = newTeams.get(event.teamId);
          if (!team) {
            team = {
              id: event.teamId,
              name: event.teamId,
              memberIds: [event.agentId],
              status: "forming",
              task: event.task,
              startTime: timestamp,
            };
          } else {
            team = { ...team, memberIds: [...team.memberIds, event.agentId] };
          }
          if (event.agentType === "team-lead") {
            team = { ...team, leaderId: event.agentId, status: "active" };
          }
          newTeams.set(event.teamId, team);
          newTeamsUpdate = newTeams;
        }
        break;
      }
      case "agent:status": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          newAgents.set(event.agentId, { ...agent, status: event.status });
        }
        const updatedAgentStatus = newAgents.get(event.agentId);
        if (updatedAgentStatus?.teamId) {
          const { teams } = get();
          const newTeams = new Map(teams);
          const team = newTeams.get(updatedAgentStatus.teamId);
          if (team) {
            const members = team.memberIds.map(id => newAgents.get(id)).filter(Boolean);
            const anyError = members.some(a => a!.status === "error");
            const allCompleted = members.every(a => a!.status === "completed");
            const anyRunning = members.some(a => a!.status === "running" || a!.status === "idle");
            let newStatus = team.status;
            if (anyError) newStatus = "error";
            else if (allCompleted) newStatus = "completed";
            else if (anyRunning) newStatus = "active";
            newTeams.set(team.id, { ...team, status: newStatus });
            newTeamsUpdate = newTeams;
          }
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
        const updatedAgentComplete = newAgents.get(event.agentId);
        if (updatedAgentComplete?.teamId) {
          const { teams } = get();
          const newTeams = new Map(teams);
          const team = newTeams.get(updatedAgentComplete.teamId);
          if (team) {
            const members = team.memberIds.map(id => newAgents.get(id)).filter(Boolean);
            const anyError = members.some(a => a!.status === "error");
            const allCompleted = members.every(a => a!.status === "completed");
            const anyRunning = members.some(a => a!.status === "running" || a!.status === "idle");
            let newStatus = team.status;
            if (anyError) newStatus = "error";
            else if (allCompleted) newStatus = "completed";
            else if (anyRunning) newStatus = "active";
            newTeams.set(team.id, { ...team, status: newStatus });
            newTeamsUpdate = newTeams;
          }
        }
        break;
      }
      case "agent:message": {
        const messageEdge = { source: event.fromId, target: event.toId, edgeType: "message" as const };
        if (!newEdges.some(e => e.source === event.fromId && e.target === event.toId && e.edgeType === "message")) {
          newEdges = [...newEdges, messageEdge];
        }
        break;
      }
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
      ...(newTeamsUpdate ? { teams: newTeamsUpdate } : {}),
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

  viewMode: "graph",
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
    const { agents, edges, teams } = get();
    const agent = agents.get(agentId);
    const newAgents = new Map(agents);
    newAgents.delete(agentId);
    const newEdges = edges.filter(
      (e) => e.source !== agentId && e.target !== agentId
    );
    const newTeams = new Map(teams);
    if (agent?.teamId) {
      const team = newTeams.get(agent.teamId);
      if (team) {
        const updatedMembers = team.memberIds.filter(id => id !== agentId);
        if (updatedMembers.length === 0) {
          newTeams.delete(agent.teamId);
        } else {
          newTeams.set(agent.teamId, { ...team, memberIds: updatedMembers });
        }
      }
    }
    set({ agents: newAgents, edges: newEdges, teams: newTeams });
  },
}));
