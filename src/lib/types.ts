/**
 * SSE Protocol Contract
 * ─────────────────────
 * This file is the single source of truth for the dashboard ↔ server wire
 * protocol. All message shapes (`ServerEvent`, `AgentEvent`) live here and
 * are imported by both the frontend (`src/`) and the backend (`scripts/`).
 *
 * Protocol version: 1. Bump on backwards-incompatible changes (renamed or
 * removed fields, changed field types). Adding new optional fields or new
 * event variants does NOT require a bump.
 *
 * On connect the server sends `state:sync` with `protocolVersion`. The client
 * warns once if the version is missing or mismatched and then continues —
 * minor drift is permissive, not fatal.
 *
 * Heartbeat: handled at the SSE transport layer via `: keepalive\n\n`
 * comments every 15s. No protocol-level ping/pong messages.
 */

/** Current protocol version. Bump on any backwards-incompatible change. */
export const PROTOCOL_VERSION = 1;

export const AGENT_STATUSES = ["running", "waiting", "idle", "completed", "error"] as const;
export type AgentStatus = typeof AGENT_STATUSES[number];

export const AGENT_TYPES = ["main", "explore", "plan", "build", "review", "test", "team-lead", "generic"] as const;
export type AgentType = typeof AGENT_TYPES[number];

export type TeamStatus = "forming" | "active" | "completed" | "error";

/** Extended-thinking effort tier surfaced on the topology under main agents. */
export const THINKING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "auto"] as const;
export type ThinkingEffort = typeof THINKING_EFFORTS[number];

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
      effort?: ThinkingEffort;
      is1MContext?: boolean;
      workflowName?: string;
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
  | { type: "state:sync"; agents: AgentState[]; edges: EdgeState[]; teams: TeamState[]; workflows?: WorkflowRunState[]; protocolVersion?: number }
  | { type: "state:update"; event: AgentEvent; timestamp: number }
  | { type: "state:remove"; agentId: string }
  | { type: "annotation:sync"; annotations: Annotation[] }
  | { type: "annotation:update"; annotation: Annotation; action: "add" | "remove" }
  | { type: "workflow:update"; workflow: WorkflowRunState }
  | { type: "workflow:remove"; runId: string };

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
  /** Extended-thinking effort tier (low|medium|high|xhigh|max|auto). Rendered
   *  as the second line in the hexagon center, stacked under the model family. */
  effort?: ThinkingEffort;
  /** True when the user has the 1M-context beta enabled (settings.json
   *  `model` field carries the `[1m]` suffix). */
  is1MContext?: boolean;
  /** Workflow name (from the run-script filename) for agents in a live
   *  workflow whose completion-time wf_*.json (and real per-agent label) is
   *  not on disk yet. Rendered as a sub-label fallback under the real label. */
  workflowName?: string;
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

// ── Workflow Monitoring ───────────────────────────────
export type WorkflowStatus = "running" | "completed" | "failed";

export interface WorkflowPhase {
  index: number;
  title: string;
  detail?: string;
}

export interface WorkflowAgentRef {
  agentId: string;
  label: string;
  phaseIndex?: number;
  phaseTitle?: string;
  model?: string;
  state: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}

export interface WorkflowRunState {
  runId: string;
  sessionId: string;
  name: string;
  status: WorkflowStatus;
  startTime: number;
  durationMs?: number;
  agentCount: number;
  totalTokens?: number;
  totalToolCalls?: number;
  summary?: string;
  phases: WorkflowPhase[];
  agents: WorkflowAgentRef[];
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
