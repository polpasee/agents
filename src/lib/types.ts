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

export const AGENT_STATUSES = [
  "running",
  "waiting",
  "idle",
  "completed",
  "error",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_TYPES = [
  "main",
  "explore",
  "plan",
  "build",
  "review",
  "test",
  "team-lead",
  "generic",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type TeamStatus = "forming" | "active" | "completed" | "error";

/** Extended-thinking effort tier surfaced on the topology under main agents. */
export const THINKING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

// Events sent from the file watcher to the dashboard
export type AgentEvent =
  | {
      type: "agent:register";
      agentId: string;
      parentId?: string | undefined;
      agentType: AgentType;
      displayType?: string | undefined;
      task: string;
      sessionId?: string | undefined;
      slug?: string | undefined;
      model?: string | undefined;
      teamId?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
      effort?: ThinkingEffort | undefined;
      is1MContext?: boolean | undefined;
      workflowName?: string | undefined;
    }
  | {
      type: "agent:status";
      agentId: string;
      status: AgentStatus;
      message?: string | undefined;
      waitingOn?: string | undefined; // F1: agentId this agent is blocked on
    }
  | {
      type: "agent:tool_call";
      agentId: string;
      tool: string;
      args?: string | undefined;
      result?: string | undefined;
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
      summary?: string | undefined;
      duration: number;
    };

// Events sent from server to dashboard
export type ServerEvent =
  | {
      type: "state:sync";
      agents: AgentState[];
      edges: EdgeState[];
      teams: TeamState[];
      workflows?: WorkflowRunState[] | undefined;
      protocolVersion?: number | undefined;
    }
  | { type: "state:update"; event: AgentEvent; timestamp: number }
  | { type: "state:remove"; agentId: string }
  | { type: "annotation:sync"; annotations: Annotation[] }
  | {
      type: "annotation:update";
      annotation: Annotation;
      action: "add" | "remove";
    }
  | { type: "workflow:update"; workflow: WorkflowRunState }
  | { type: "workflow:remove"; runId: string };

export interface AgentState {
  id: string;
  parentId?: string | undefined;
  agentType: AgentType;
  /** Raw meta.agentType string (e.g. "api-builder", "frontend-ui"). Used for
   *  display so the topology label matches what Claude shows in the terminal.
   *  agentType still drives color and coarse categorization. */
  displayType?: string | undefined;
  status: AgentStatus;
  task: string;
  sessionId?: string | undefined;
  slug?: string | undefined;
  model?: string | undefined;
  teamId?: string | undefined;
  toolCalls: ToolCallEntry[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  contextWindow: number;
  startTime: number;
  duration?: number | undefined;
  summary?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  waitingOn?: string | undefined; // F1: dependency tracking
  budgetExceeded?: boolean | undefined; // F3: token budget exceeded flag
  /** Extended-thinking effort tier (low|medium|high|xhigh|max|auto). Rendered
   *  as the second line in the hexagon center, stacked under the model family. */
  effort?: ThinkingEffort | undefined;
  /** True when the user has the 1M-context beta enabled (settings.json
   *  `model` field carries the `[1m]` suffix). */
  is1MContext?: boolean | undefined;
  /** Workflow name (from the run-script filename) for agents in a live
   *  workflow whose completion-time wf_*.json (and real per-agent label) is
   *  not on disk yet. Rendered as a sub-label fallback under the real label. */
  workflowName?: string | undefined;
}

export interface ToolCallEntry {
  tool: string;
  args?: string | undefined;
  result?: string | undefined;
  timestamp: number;
}

export interface EdgeState {
  source: string;
  target: string;
  edgeType?: "parent" | "message" | "blocking" | undefined; // F1: blocking edge type
}

export interface TeamState {
  id: string;
  name: string;
  leaderId?: string | undefined;
  memberIds: string[];
  status: TeamStatus;
  task: string;
  startTime: number;
}

// ── Workflow Monitoring ───────────────────────────────
export type WorkflowStatus = "running" | "completed" | "failed";

/** Closed union of per-agent state values emitted by the workflow runner.
 *  "unknown" is the fallback for any unrecognized value in the JSONL data. */
export type WorkflowAgentState =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "unknown";

export interface WorkflowPhase {
  index: number;
  title: string;
  detail?: string | undefined;
}

export interface WorkflowAgentRef {
  agentId: string;
  label: string;
  phaseIndex?: number | undefined;
  phaseTitle?: string | undefined;
  model?: string | undefined;
  state: WorkflowAgentState;
  tokens?: number | undefined;
  toolCalls?: number | undefined;
  durationMs?: number | undefined;
}

export interface WorkflowRunState {
  runId: string;
  sessionId: string;
  name: string;
  status: WorkflowStatus;
  startTime: number;
  durationMs?: number | undefined;
  agentCount: number;
  totalTokens?: number | undefined;
  totalToolCalls?: number | undefined;
  summary?: string | undefined;
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
  toolCalls?: LogToolCall[] | undefined;
}

export interface LogToolCall {
  id: string;
  name: string;
  input: string;
  result?: string | undefined;
}

// ── Cost Projections ──────────────────────────────────
export interface CostProjectionData {
  burnRate: number;
  projectedTotal: number;
  timeToThreshold: number;
  percentOfBudget: number;
}

// ── Performance Heatmap ───────────────────────────────
export type HeatmapMetric =
  | "idleRatio"
  | "tokenEfficiency"
  | "timeToFirstTool"
  | "avgToolLatency";

// ── F1: Agent Dependency Graph ────────────────────────
// (waitingOn on AgentState and agent:status event, blocking edge type on EdgeState)

// ── F2: Error Drill-Down ──────────────────────────────
export interface ErrorDetail {
  agentId: string;
  message: string;
  stackTrace?: string | undefined;
  lastToolCall?: ToolCallEntry | undefined;
  cascadeIds?: string[] | undefined; // related error agent IDs
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
  author?: string | undefined;
  timestamp: number;
  x?: number | undefined;
  y?: number | undefined;
}

// ── F8: Agent Diff View ──────────────────────────────
export interface FileModification {
  filePath: string;
  operation: "create" | "edit" | "delete";
  diff?: string | undefined;
  timestamp: number;
}

// ── F11: Theme ───────────────────────────────────────
export type ThemeMode = "dark" | "light";

// ── Layout Tuning ─────────────────────────────────────
export interface LayoutTuning {
  subAgentDistance: number; // Main↔sub-agent link distance & spoke radius (px)
  siblingRepulsion: number; // sub-agent family charge strength (negative)
  mainRepulsion: number; // main agent charge strength (negative)
  fanStrength: number; // radial spoke force strength 0..1
  fanSpreadDeg: number; // radial fan arc span in DEGREES
  mainPeerDistance: number; // main↔main / peer link distance (px)
  chargeReach: number; // family charge distanceMax (px)
  globalRepulsion: number; // weak global personal-space charge (negative)
  collisionPadding: number; // extra collision radius padding (px)
}

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
