import type { StateCreator } from "zustand";
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  TeamState,
  TeamStats,
  ErrorDetail,
  AgentTypeBudgets,
  AgentType,
  ToolCallEntry,
} from "../types";
import { ACTIVITY_MAX_ENTRIES, TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW } from "../config";
import { calculateCost } from "../costs";
import type { AgentStore } from "./types";
import { computeTeamStatus, incrementActivityCounter, loadLocalStorage } from "./helpers";

export type AgentSlice = Pick<AgentStore,
  | "agents" | "edges" | "activity" | "teams" | "connected" | "recording" | "recordedEvents"
  | "setConnected" | "syncState" | "handleEvent" | "removeAgent" | "getTeamStats"
  | "startRecording" | "downloadRecording"
  | "errorDetails" | "setErrorDetail"
  | "agentTypeBudgets" | "setAgentTypeBudget"
>;

export const createAgentSlice: StateCreator<AgentStore, [], [], AgentSlice> = (set, get) => ({
  agents: new Map(),
  edges: [],
  activity: [],
  teams: new Map(),
  connected: false,
  recording: false,
  recordedEvents: [],

  setConnected: (connected) => set({ connected }),

  getTeamStats: (teamId) => {
    const { agents, teams } = get();
    const team = teams.get(teamId);
    if (!team) return { totalTokens: 0, totalCost: 0, memberCount: 0, completedCount: 0, errorCount: 0, activeCount: 0 };
    const members = team.memberIds.map(id => agents.get(id)).filter(Boolean) as AgentState[];
    let totalTokens = 0;
    let totalCost = 0;
    let completedCount = 0;
    let errorCount = 0;
    let activeCount = 0;
    for (const m of members) {
      totalTokens += m.inputTokens + m.outputTokens;
      totalCost += calculateCost(m).total;
      if (m.status === "completed") completedCount++;
      else if (m.status === "error") errorCount++;
      else if (m.status === "running" || m.status === "idle") activeCount++;
    }
    return { totalTokens, totalCost, memberCount: members.length, completedCount, errorCount, activeCount };
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
    const { agents, edges, activity, recording, recordedEvents, agentTypeBudgets } = get();
    const newAgents = new Map(agents);
    let newEdges = edges;
    let newTeamsUpdate: Map<string, TeamState> | null = null;

    switch (event.type) {
      case "agent:register": {
        // If the agent is already live, treat register as a metadata
        // refresh — fill in missing fields (e.g. model learned lazily)
        // without wiping accumulated state like toolCalls or tokens.
        const existing = newAgents.get(event.agentId);
        const agent: AgentState = existing
          ? {
              ...existing,
              // Model can change mid-session (Sonnet → Opus switch) — always
              // take the incoming value when provided so the label is live.
              model: event.model || existing.model || "",
              task: existing.task || event.task,
              slug: existing.slug || event.slug,
              agentType: event.agentType || existing.agentType,
              displayType: existing.displayType || event.displayType,
              metadata: existing.metadata || event.metadata,
            }
          : {
              id: event.agentId,
              parentId: event.parentId,
              agentType: event.agentType,
              displayType: event.displayType,
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
        // Edge and team membership only on first register — avoids duplicate
        // edges when register is replayed as a metadata refresh.
        if (!existing) {
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
        }
        break;
      }
      case "agent:status": {
        const agent = newAgents.get(event.agentId);
        if (agent) {
          const updates: Partial<AgentState> = { status: event.status };
          // F1: dependency tracking
          if (event.waitingOn) {
            updates.waitingOn = event.waitingOn;
            const blockingEdge: EdgeState = { source: event.waitingOn, target: event.agentId, edgeType: "blocking" };
            if (!newEdges.some(e => e.source === event.waitingOn && e.target === event.agentId && e.edgeType === "blocking")) {
              newEdges = [...newEdges, blockingEdge];
            }
          } else if (agent.waitingOn && event.status !== "waiting") {
            // Clear blocking edge when no longer waiting
            updates.waitingOn = undefined;
            newEdges = newEdges.filter(e => !(e.target === event.agentId && e.edgeType === "blocking"));
          }
          // F2: error detail extraction
          if (event.status === "error") {
            const lastTool = agent.toolCalls.length > 0 ? agent.toolCalls[agent.toolCalls.length - 1] : undefined;
            const { errorDetails } = get();
            const newErrors = new Map(errorDetails);
            // Find cascading errors (parent/child with errors)
            const cascadeIds: string[] = [];
            for (const [id, a] of newAgents) {
              if (id !== event.agentId && a.status === "error" && (a.parentId === event.agentId || agent.parentId === id)) {
                cascadeIds.push(id);
              }
            }
            newErrors.set(event.agentId, {
              agentId: event.agentId,
              message: event.message || "Agent encountered an error",
              lastToolCall: lastTool,
              cascadeIds,
              timestamp,
            });
            set({ errorDetails: newErrors });
          }
          newAgents.set(event.agentId, { ...agent, ...updates });
        }
        const updatedAgentStatus = newAgents.get(event.agentId);
        if (updatedAgentStatus?.teamId) {
          const { teams } = get();
          const newTeams = new Map(teams);
          const team = newTeams.get(updatedAgentStatus.teamId);
          if (team) {
            const newStatus = computeTeamStatus(team.memberIds, newAgents, team.status);
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
          const totalTokens = event.inputTokens + event.outputTokens;
          // F3: check token budget
          const budgetLimit = agentTypeBudgets[agent.agentType];
          const budgetExceeded = budgetLimit != null && totalTokens > budgetLimit;
          newAgents.set(event.agentId, {
            ...agent,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheCreateTokens: event.cacheCreateTokens,
            contextWindow: event.contextWindow,
            budgetExceeded,
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
            waitingOn: undefined,
          });
          // Clear any blocking edges
          newEdges = newEdges.filter(e => !(e.target === event.agentId && e.edgeType === "blocking"));
        }
        const updatedAgentComplete = newAgents.get(event.agentId);
        if (updatedAgentComplete?.teamId) {
          const { teams } = get();
          const newTeams = new Map(teams);
          const team = newTeams.get(updatedAgentComplete.teamId);
          if (team) {
            const newStatus = computeTeamStatus(team.memberIds, newAgents, team.status);
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
      { id: `act-${incrementActivityCounter()}`, timestamp, event },
    ].slice(-ACTIVITY_MAX_ENTRIES);

    set({
      agents: newAgents,
      edges: newEdges,
      activity: newActivity,
      ...(newTeamsUpdate ? { teams: newTeamsUpdate } : {}),
      ...(recording ? { recordedEvents: [...recordedEvents, { timestamp, event }] } : {}),
    });
  },

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

  // ── F2: Error Drill-Down ──────────────────────────────
  errorDetails: new Map(),

  setErrorDetail: (agentId, detail) => {
    const errorDetails = new Map(get().errorDetails);
    errorDetails.set(agentId, detail);
    set({ errorDetails });
  },

  // ── F3: Token Budget Per-Agent ────────────────────────
  agentTypeBudgets: loadLocalStorage("agentTypeBudgets", {}),

  setAgentTypeBudget: (type, limit) => {
    const { agentTypeBudgets } = get();
    const next = { ...agentTypeBudgets };
    if (limit === null) delete next[type];
    else next[type] = limit;
    if (typeof window !== "undefined") {
      localStorage.setItem("agentTypeBudgets", JSON.stringify(next));
    }
    set({ agentTypeBudgets: next });
  },
});
