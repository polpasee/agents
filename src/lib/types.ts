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
  | { type: "state:remove"; agentId: string };

export interface AgentState {
  id: string;
  parentId?: string;
  agentType: AgentType;
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
  edgeType?: "parent" | "message";
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
