import type {
  AgentState,
  EdgeState,
  ActivityEntry,
  AgentEvent,
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
  WorkflowRunState,
} from "../types";

export interface AgentStore {
  agents: Map<string, AgentState>;
  edges: EdgeState[];
  activity: ActivityEntry[];
  /** Monotonic counter for stable activity entry IDs. Reset on replay load. */
  nextActivityId: number;
  /**
   * Monotonic counter that ONLY bumps when the rendered topology actually
   * changes (agent add/remove, parentId/teamId change, edge add/remove,
   * full state resets). Lets AgentGraph rebuild the force simulation on
   * a cheap integer compare instead of recomputing a sorted-string key
   * from filteredAgents+edges on every store change. Also lets the
   * `agents` Map keep stable identity across no-op events like
   * `agent:tokens`, so `useFilteredAgents`'s memo doesn't invalidate.
   */
  topologyVersion: number;
  selectedAgentId: string | null;
  selectedSessionIds: Set<string>; // F5: multi-session (empty = all)
  /**
   * False until either (a) the auto-pick fires once on first agent arrival, or
   * (b) the user explicitly toggles a session / All. Distinguishes "fresh boot"
   * (auto-default to one session) from "user chose All" (empty set respected).
   * Not persisted — derived from presence/absence of selectedSessionIds in storage.
   */
  sessionFilterInitialized: boolean;
  connected: boolean;
  teams: Map<string, TeamState>;
  selectedTeamId: string | null;
  workflows: Map<string, WorkflowRunState>;
  selectedWorkflowId: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  selectAgent: (id: string | null) => void;
  toggleSession: (sessionId: string) => void; // F5
  selectAllSessions: () => void; // F5
  /** Pick the most-recent main session into selectedSessionIds — runs once on boot. */
  autoSelectInitialSession: () => void;
  selectTeam: (teamId: string | null) => void;
  selectWorkflow: (runId: string | null) => void;
  upsertWorkflow: (run: WorkflowRunState) => void;
  removeWorkflow: (runId: string) => void;
  getTeamStats: (teamId: string) => TeamStats;
  syncState: (agents: AgentState[], edges: EdgeState[], teams: TeamState[], workflows?: WorkflowRunState[]) => void;
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
  transcriptOpen: boolean;
  fileAttentionOpen: boolean;
  toggleTranscript: () => void;
  toggleFileAttention: () => void;

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
  replaceAnnotations: (annotations: Annotation[]) => void;

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
  loadComparison: (left: string, right: string) => void;
  exitComparison: () => void;

  // Sound
  soundMuted: boolean;
  toggleSoundMute: () => void;

  // Hydration
  hydrateUI: () => void;
}
