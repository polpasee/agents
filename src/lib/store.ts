import { create } from "zustand";
import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
  ToolCallEntry,
  TeamState,
  TeamStats,
  ReplayState,
  ReplaySpeed,
  RecordedSession,
  LogEntry,
  HeatmapMetric,
  ErrorDetail,
  AgentTypeBudgets,
  MetricSample,
  Annotation,
  FileModification,
  ThemeMode,
  GraphLayout,
  ComparisonState,
  AgentType,
} from "./types";
import { ACTIVITY_MAX_ENTRIES, TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW, METRIC_HISTORY_MAX } from "./config";

interface AgentStore {
  agents: Map<string, AgentState>;
  edges: EdgeState[];
  activity: ActivityEntry[];
  selectedAgentId: string | null;
  selectedSessionIds: Set<string>; // F5: multi-session (empty = all)
  connected: boolean;
  teams: Map<string, TeamState>;
  selectedTeamId: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  selectAgent: (id: string | null) => void;
  toggleSession: (sessionId: string) => void; // F5
  selectAllSessions: () => void; // F5
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

  // Replay
  replay: ReplayState;
  loadReplaySession: (session: RecordedSession) => void;
  replayPlay: () => void;
  replayPause: () => void;
  replaySeek: (timestamp: number) => void;
  replaySetSpeed: (speed: ReplaySpeed) => void;
  replayExit: () => void;
  replayTick: (upToTimestamp: number) => void;

  // Log Viewer
  logEntries: Map<string, LogEntry[]>;
  logLoading: Set<string>;
  logViewerAgentId: string | null;
  openLogViewer: (agentId: string) => void;
  closeLogViewer: () => void;
  setLogEntries: (agentId: string, entries: LogEntry[]) => void;
  setLogLoading: (agentId: string, loading: boolean) => void;

  // Cost Budget
  budgetThreshold: number | null;
  setBudgetThreshold: (amount: number | null) => void;

  // Heatmap
  heatmapEnabled: boolean;
  heatmapMetric: HeatmapMetric;
  toggleHeatmap: () => void;
  setHeatmapMetric: (metric: HeatmapMetric) => void;

  // F2: Error Drill-Down
  errorDetails: Map<string, ErrorDetail>;
  errorDrillDownAgentId: string | null;
  setErrorDetail: (agentId: string, detail: ErrorDetail) => void;
  openErrorDrillDown: (agentId: string) => void;
  closeErrorDrillDown: () => void;

  // F3: Token Budget Per-Agent
  agentTypeBudgets: AgentTypeBudgets;
  setAgentTypeBudget: (type: AgentType, limit: number | null) => void;

  // F4: Live Metrics
  metricHistory: MetricSample[];
  showLiveMetrics: boolean;
  pushMetricSample: (sample: MetricSample) => void;
  toggleLiveMetrics: () => void;

  // F6: Annotations
  annotations: Map<string, Annotation>;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;

  // F8: Diff View
  agentDiffs: Map<string, FileModification[]>;
  diffViewerAgentId: string | null;
  setAgentDiffs: (agentId: string, diffs: FileModification[]) => void;
  openDiffViewer: (agentId: string) => void;
  closeDiffViewer: () => void;

  // F10: Export Report
  showExportModal: boolean;
  toggleExportModal: () => void;

  // F11: Theme
  theme: ThemeMode;
  toggleTheme: () => void;

  // F12: Graph Layout
  graphLayout: GraphLayout;
  setGraphLayout: (layout: GraphLayout) => void;

  // F14: Session Comparison
  comparison: ComparisonState;
  loadComparison: (left: RecordedSession, right: RecordedSession) => void;
  exitComparison: () => void;
}

let activityCounter = 0;

function loadLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: new Map(),
  edges: [],
  activity: [],
  selectedAgentId: null,
  selectedSessionIds: new Set(), // F5: empty = all sessions
  connected: false,
  teams: new Map(),
  selectedTeamId: null,

  setConnected: (connected) => set({ connected }),

  selectAgent: (id) => set({ selectedAgentId: id }),

  // F5: multi-session toggle
  toggleSession: (sessionId) => {
    const { selectedSessionIds } = get();
    const next = new Set(selectedSessionIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    set({ selectedSessionIds: next, selectedAgentId: null });
  },

  selectAllSessions: () => set({ selectedSessionIds: new Set(), selectedAgentId: null }),

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
    const { agents, edges, activity, recording, recordedEvents, agentTypeBudgets } = get();
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

  // ── Replay ────────────────────────────────────────────
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

  loadReplaySession: (session) => {
    const endTime = session.events.length > 0
      ? session.events[session.events.length - 1].timestamp
      : session.startTime;
    set({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
      replay: {
        active: true,
        session,
        playing: false,
        speed: 1,
        currentIndex: 0,
        currentTime: session.startTime,
        startTime: session.startTime,
        endTime,
      },
    });
  },

  replayPlay: () => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, playing: true } });
  },

  replayPause: () => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, playing: false } });
  },

  replaySeek: (timestamp) => {
    const { replay } = get();
    if (!replay.active || !replay.session) return;
    set({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      replay: { ...replay, currentIndex: 0, currentTime: replay.startTime },
    });
    get().replayTick(timestamp);
  },

  replaySetSpeed: (speed) => {
    const { replay } = get();
    if (replay.active) set({ replay: { ...replay, speed } });
  },

  replayExit: () => {
    set({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
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
  },

  replayTick: (upToTimestamp) => {
    const { replay, handleEvent } = get();
    if (!replay.active || !replay.session) return;
    const events = replay.session.events;
    let idx = replay.currentIndex;
    while (idx < events.length && events[idx].timestamp <= upToTimestamp) {
      handleEvent(events[idx].event, events[idx].timestamp);
      idx++;
    }
    const newReplay = get().replay;
    set({ replay: { ...newReplay, currentIndex: idx, currentTime: upToTimestamp } });
  },

  // ── Log Viewer ────────────────────────────────────────
  logEntries: new Map(),
  logLoading: new Set(),
  logViewerAgentId: null,

  openLogViewer: (agentId) => set({ logViewerAgentId: agentId }),
  closeLogViewer: () => set({ logViewerAgentId: null }),

  setLogEntries: (agentId, entries) => {
    const logEntries = new Map(get().logEntries);
    logEntries.set(agentId, entries);
    const logLoading = new Set(get().logLoading);
    logLoading.delete(agentId);
    set({ logEntries, logLoading });
  },

  setLogLoading: (agentId, loading) => {
    const logLoading = new Set(get().logLoading);
    if (loading) logLoading.add(agentId);
    else logLoading.delete(agentId);
    set({ logLoading });
  },

  // ── Cost Budget ───────────────────────────────────────
  budgetThreshold: null,

  setBudgetThreshold: (amount) => {
    if (typeof window !== "undefined") {
      if (amount !== null) localStorage.setItem("budgetThreshold", String(amount));
      else localStorage.removeItem("budgetThreshold");
    }
    set({ budgetThreshold: amount });
  },

  // ── Heatmap ───────────────────────────────────────────
  heatmapEnabled: false,
  heatmapMetric: "tokenEfficiency",

  toggleHeatmap: () => set({ heatmapEnabled: !get().heatmapEnabled }),
  setHeatmapMetric: (metric) => set({ heatmapMetric: metric }),

  // ── F2: Error Drill-Down ──────────────────────────────
  errorDetails: new Map(),
  errorDrillDownAgentId: null,

  setErrorDetail: (agentId, detail) => {
    const errorDetails = new Map(get().errorDetails);
    errorDetails.set(agentId, detail);
    set({ errorDetails });
  },

  openErrorDrillDown: (agentId) => set({ errorDrillDownAgentId: agentId }),
  closeErrorDrillDown: () => set({ errorDrillDownAgentId: null }),

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

  // ── F4: Live Metrics ──────────────────────────────────
  metricHistory: [],
  showLiveMetrics: false,

  pushMetricSample: (sample) => {
    const history = [...get().metricHistory, sample].slice(-METRIC_HISTORY_MAX);
    set({ metricHistory: history });
  },

  toggleLiveMetrics: () => set({ showLiveMetrics: !get().showLiveMetrics }),

  // ── F6: Annotations ───────────────────────────────────
  annotations: new Map(),

  addAnnotation: (annotation) => {
    const annotations = new Map(get().annotations);
    annotations.set(annotation.id, annotation);
    set({ annotations });
  },

  removeAnnotation: (id) => {
    const annotations = new Map(get().annotations);
    annotations.delete(id);
    set({ annotations });
  },

  updateAnnotation: (id, updates) => {
    const annotations = new Map(get().annotations);
    const existing = annotations.get(id);
    if (existing) {
      annotations.set(id, { ...existing, ...updates });
      set({ annotations });
    }
  },

  // ── F8: Diff View ─────────────────────────────────────
  agentDiffs: new Map(),
  diffViewerAgentId: null,

  setAgentDiffs: (agentId, diffs) => {
    const agentDiffs = new Map(get().agentDiffs);
    agentDiffs.set(agentId, diffs);
    set({ agentDiffs });
  },

  openDiffViewer: (agentId) => set({ diffViewerAgentId: agentId }),
  closeDiffViewer: () => set({ diffViewerAgentId: null }),

  // ── F10: Export Report ────────────────────────────────
  showExportModal: false,
  toggleExportModal: () => set({ showExportModal: !get().showExportModal }),

  // ── F11: Theme ────────────────────────────────────────
  theme: loadLocalStorage<ThemeMode>("theme", "dark"),

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", JSON.stringify(next));
    }
    set({ theme: next });
  },

  // ── F12: Graph Layout ─────────────────────────────────
  graphLayout: "force",
  setGraphLayout: (layout) => set({ graphLayout: layout }),

  // ── F14: Session Comparison ───────────────────────────
  comparison: { active: false, leftSession: null, rightSession: null },

  loadComparison: (left, right) => set({
    comparison: { active: true, leftSession: left, rightSession: right },
  }),

  exitComparison: () => set({
    comparison: { active: false, leftSession: null, rightSession: null },
  }),
}));
