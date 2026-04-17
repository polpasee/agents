export type AgentStatus = "running" | "waiting" | "idle" | "completed" | "error";

export type AgentType =
  | "main"
  | "explore"
  | "plan"
  | "build"
  | "review"
  | "test"
  | "team-lead"
  | "generic";

export type TeamStatus = "forming" | "active" | "completed" | "error";

// Events sent from the file watcher to the dashboard
export type AgentEvent =
  | {
      type: "agent:register";
      agentId: string;
      parentId?: string;
      agentType: AgentType;
      displayType?: string;
      task: string;
      sessionId?: string;
      slug?: string;
      model?: string;
      teamId?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "agent:status";
      agentId: string;
      status: AgentStatus;
      message?: string;
      waitingOn?: string; // F1: agentId this agent is blocked on
    }
  | {
      type: "agent:tool_call";
      agentId: string;
      tool: string;
      args?: string;
      result?: string;
    }
  | {
      type: "agent:tokens";
      agentId: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreateTokens: number;
      contextWindow: number;
    }
  | {
      type: "agent:message";
      fromId: string;
      toId: string;
      content: string;
    }
  | {
      type: "agent:complete";
      agentId: string;
      summary?: string;
      duration: number;
    };

// Events sent from server to dashboard
export type ServerEvent =
  | { type: "state:sync"; agents: AgentState[]; edges: EdgeState[]; teams: TeamState[] }
  | { type: "state:update"; event: AgentEvent; timestamp: number }
  | { type: "state:remove"; agentId: string }
  | { type: "log:response"; agentId: string; entries: LogEntry[] }
  | { type: "log:error"; agentId: string; error: string }
  | { type: "annotation:sync"; annotations: Annotation[] }
  | { type: "annotation:update"; annotation: Annotation; action: "add" | "remove" };

export interface AgentState {
  id: string;
  parentId?: string;
  agentType: AgentType;
  /** Raw meta.agentType string (e.g. "api-builder", "frontend-ui"). Used for
   *  display so the topology label matches what Claude shows in the terminal.
   *  agentType still drives color and coarse categorization. */
  displayType?: string;
  status: AgentStatus;
  task: string;
  sessionId?: string;
  slug?: string;
  model?: string;
  teamId?: string;
  toolCalls: ToolCallEntry[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  contextWindow: number;
  startTime: number;
  duration?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
  waitingOn?: string; // F1: dependency tracking
  budgetExceeded?: boolean; // F3: token budget exceeded flag
}

export interface ToolCallEntry {
  tool: string;
  args?: string;
  result?: string;
  timestamp: number;
}

export interface EdgeState {
  source: string;
  target: string;
  edgeType?: "parent" | "message" | "blocking"; // F1: blocking edge type
}

export interface TeamState {
  id: string;
  name: string;
  leaderId?: string;
  memberIds: string[];
  status: TeamStatus;
  task: string;
  startTime: number;
}

export interface TeamStats {
  totalTokens: number;
  totalCost: number;
  memberCount: number;
  completedCount: number;
  errorCount: number;
  activeCount: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  event: AgentEvent;
}

export interface RecordedSession {
  startTime: number;
  events: Array<{ timestamp: number; event: AgentEvent }>;
}

// ── Session Replay ────────────────────────────────────
export type ReplaySpeed = 0.5 | 1 | 2 | 4;

export interface ReplayState {
  active: boolean;
  session: RecordedSession | null;
  playing: boolean;
  speed: ReplaySpeed;
  currentIndex: number;
  currentTime: number;
  startTime: number;
  endTime: number;
}

// ── Agent Log Viewer ──────────────────────────────────
export interface LogEntry {
  timestamp: number;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: LogToolCall[];
}

export interface LogToolCall {
  id: string;
  name: string;
  input: string;
  result?: string;
}

// ── Client → Server Events ────────────────────────────
export type ClientEvent =
  | { type: "log:request"; agentId: string }
  | { type: "annotation:add"; annotation: Annotation }
  | { type: "annotation:remove"; annotationId: string };

// ── Cost Projections ──────────────────────────────────
export interface CostProjectionData {
  burnRate: number;
  projectedTotal: number;
  timeToThreshold: number;
  percentOfBudget: number;
}

// ── Performance Heatmap ───────────────────────────────
export type HeatmapMetric = "idleRatio" | "tokenEfficiency" | "timeToFirstTool" | "avgToolLatency";

// ── F1: Agent Dependency Graph ────────────────────────
// (waitingOn on AgentState and agent:status event, blocking edge type on EdgeState)

// ── F2: Error Drill-Down ──────────────────────────────
export interface ErrorDetail {
  agentId: string;
  message: string;
  stackTrace?: string;
  lastToolCall?: ToolCallEntry;
  cascadeIds?: string[]; // related error agent IDs
  timestamp: number;
}

// ── F3: Token Budget Per-Agent ────────────────────────
export type AgentTypeBudgets = Partial<Record<AgentType, number>>;

// ── F4: Live Metrics Dashboard ────────────────────────
export interface MetricSample {
  timestamp: number;
  tokensPerSec: number;
  costPerMin: number;
  activeCount: number;
  totalCost: number;
  totalTokens: number;
}

// ── F6: Shared Annotations ───────────────────────────
export interface Annotation {
  id: string;
  targetId: string;
  targetType: "agent" | "edge";
  text: string;
  author?: string;
  timestamp: number;
  x?: number;
  y?: number;
}

// ── F8: Agent Diff View ──────────────────────────────
export interface FileModification {
  filePath: string;
  operation: "create" | "edit" | "delete";
  diff?: string;
  timestamp: number;
}

// ── F10: Export Report ───────────────────────────────
export interface ReportData {
  generatedAt: number;
  duration: number;
  agents: AgentState[];
  teams: TeamState[];
  totalCost: number;
  errors: { agentId: string; message: string }[];
}

// ── F11: Theme ───────────────────────────────────────
export type ThemeMode = "dark" | "light";

// ── F12: Graph Layout Modes ──────────────────────────
export type GraphLayout = "force" | "tree" | "radial" | "hierarchical";

// ── F14: Session Comparison ──────────────────────────
export interface ComparisonState {
  active: boolean;
  leftSession: string | null;
  rightSession: string | null;
}

// ── F15: Agent Efficiency Score ──────────────────────
export interface EfficiencyScore {
  overall: number; // 0-100
  tokenEfficiency: number;
  toolSuccessRate: number;
  completionSpeed: number;
}
