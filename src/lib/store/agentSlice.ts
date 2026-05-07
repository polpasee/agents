import type { StateCreator } from "zustand";
import type {
  AgentState,
  TeamState,
} from "../types";
import { ACTIVITY_MAX_ENTRIES, RECORDING_MAX_EVENTS } from "../config";
import { calculateCost } from "../costs";
import { isValidAgentEvent } from "../validation";
import type { AgentStore } from "./types";
import { isDuplicateActivity } from "./helpers";
import {
  createMutationContext,
  applyRegister,
  applyStatus,
  applyToolCall,
  applyTokens,
  applyComplete,
  applyMessage,
} from "./eventHandlers";

export type AgentSlice = Pick<AgentStore,
  | "agents" | "edges" | "activity" | "nextActivityId" | "topologyVersion" | "teams" | "connected" | "recording" | "recordedEvents"
  | "setConnected" | "syncState" | "handleEvent" | "removeAgent" | "getTeamStats"
  | "startRecording" | "downloadRecording"
  | "errorDetails" | "setErrorDetail"
  | "agentTypeBudgets" | "setAgentTypeBudget"
>;

export const createAgentSlice: StateCreator<AgentStore, [], [], AgentSlice> = (set, get) => ({
  agents: new Map(),
  edges: [],
  activity: [],
  nextActivityId: 0,
  topologyVersion: 0,
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
    // Full snapshot replace — anything could have moved.
    set({ agents, edges, teams, topologyVersion: get().topologyVersion + 1 });
  },

  handleEvent: (event, timestamp) => {
    if (!isValidAgentEvent(event)) return;
    const snapshot = get();
    const ctx = createMutationContext({
      agents: snapshot.agents,
      edges: snapshot.edges,
      errorDetails: snapshot.errorDetails,
      teams: snapshot.teams,
      agentTypeBudgets: snapshot.agentTypeBudgets,
    });

    switch (event.type) {
      case "agent:register":  applyRegister(ctx, event, timestamp); break;
      case "agent:status":    applyStatus(ctx, event, timestamp); break;
      case "agent:tool_call": applyToolCall(ctx, event, timestamp); break;
      case "agent:tokens":    applyTokens(ctx, event); break;
      case "agent:complete":  applyComplete(ctx, event); break;
      case "agent:message":   applyMessage(ctx, event); break;
      default: { const _exhaustive: never = event; void _exhaustive; }
    }

    const { activity, nextActivityId, recording, recordedEvents, topologyVersion, edges } = snapshot;
    const isDuplicate = isDuplicateActivity(activity, event);
    const newActivityId = isDuplicate ? nextActivityId : nextActivityId + 1;
    const newActivity = isDuplicate
      ? activity
      : [
          ...activity,
          { id: `act-${newActivityId}`, timestamp, event },
        ].slice(-ACTIVITY_MAX_ENTRIES);

    if (recording) {
      recordedEvents.push({ timestamp, event });
      if (recordedEvents.length > RECORDING_MAX_EVENTS) {
        recordedEvents.splice(0, recordedEvents.length - RECORDING_MAX_EVENTS);
      }
    }

    set({
      ...(ctx.newAgents ? { agents: ctx.newAgents } : {}),
      ...(ctx.newEdges !== edges ? { edges: ctx.newEdges } : {}),
      activity: newActivity,
      nextActivityId: newActivityId,
      ...(ctx.newTeams ? { teams: ctx.newTeams } : {}),
      ...(ctx.newErrorDetails ? { errorDetails: ctx.newErrorDetails } : {}),
      ...(ctx.topologyDirty ? { topologyVersion: topologyVersion + 1 } : {}),
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
    const { agents, edges, teams, selectedSessionIds } = get();
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
    // Prune the dismissed main's session id from the filter so the user isn't
    // left staring at an empty graph. Falling to empty here is a *consequence*
    // of dismissal, not an explicit "All" — but showing the remaining sessions
    // is a saner fallback than a blank canvas.
    let nextSelectedSessionIds = selectedSessionIds;
    if (agent && !agent.parentId) {
      const sid = agent.sessionId || agent.id;
      if (selectedSessionIds.has(sid)) {
        nextSelectedSessionIds = new Set(selectedSessionIds);
        nextSelectedSessionIds.delete(sid);
      }
    }
    set({
      agents: newAgents,
      edges: newEdges,
      teams: newTeams,
      topologyVersion: get().topologyVersion + 1,
      ...(nextSelectedSessionIds !== selectedSessionIds
        ? { selectedSessionIds: nextSelectedSessionIds }
        : {}),
    });
  },

  // ── F2: Error Drill-Down ──────────────────────────────
  errorDetails: new Map(),

  setErrorDetail: (agentId, detail) => {
    const errorDetails = new Map(get().errorDetails);
    errorDetails.set(agentId, detail);
    set({ errorDetails });
  },

  // ── F3: Token Budget Per-Agent (hydrated client-side via hydrateUI) ──
  agentTypeBudgets: {},

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
