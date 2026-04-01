import { WebSocket } from "ws";
import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  TeamState,
  ToolCallEntry,
} from "../../src/lib/types";
import {
  STATUS_RUNNING_THRESHOLD_MS,
  STATUS_IDLE_THRESHOLD_MS,
  MAX_TOOL_CALLS_PER_AGENT,
  INLINE_ARGS_MAX_KEYS,
  MAX_ARG_PREVIEW_LENGTH,
} from "./config";

// ── State ──────────────────────────────────────────────
export const agents = new Map<string, AgentState>();
export const edges: EdgeState[] = [];
export const teams = new Map<string, TeamState>();
export const viewers = new Set<WebSocket>();
export const agentLastModified = new Map<string, number>();
/** Tracks when each agent was removed so we can purge old entries */
export const removedAgentIds = new Map<string, number>();
/** Maps agentId to the JSONL file path on disk */
export const agentFilePaths = new Map<string, string>();

/** Get the JSONL file path for an agent */
export function getAgentFilePath(agentId: string): string | undefined {
  return agentFilePaths.get(agentId);
}

// ── Broadcast ──────────────────────────────────────────
export function broadcast(event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(data);
    }
  }
}

// ── Parse agent type from meta.json or slug ────────────
export function parseAgentType(raw?: string): AgentType {
  if (!raw) return "generic";
  const lower = raw.toLowerCase();
  if (lower.includes("explore")) return "explore";
  if (lower.includes("plan")) return "plan";
  if (lower.includes("build") || lower.includes("code-architect") || lower.includes("code-simplifier")) return "build";
  if (lower.includes("review") || lower.includes("code-review")) return "review";
  if (lower.includes("test") || lower.includes("pr-test")) return "test";
  if (lower.includes("team-lead")) return "team-lead";
  return "generic";
}

// ── Register an agent and broadcast ──────────────────
export function registerAgent(opts: {
  agentId: string;
  sessionId: string;
  projectDir: string;
  agentType: AgentType;
  parentId?: string;
  task: string;
  slug: string;
  model: string;
  startTime: number;
  teamId?: string;
  teamName?: string;
}) {
  const projectName = opts.projectDir.replace(/-/g, "/").replace(/^\//, "");

  const agent: AgentState = {
    id: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    status: "running",
    task: opts.task || "Session",
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1000000,
    startTime: opts.startTime,
    metadata: { projectName, projectDir: opts.projectDir },
  };

  agents.set(opts.agentId, agent);

  // Handle team membership
  if (opts.teamId) {
    let team = teams.get(opts.teamId);
    if (!team) {
      team = {
        id: opts.teamId,
        name: opts.teamName || opts.teamId,
        memberIds: [opts.agentId],
        status: "forming",
        task: opts.task || "",
        startTime: opts.startTime,
      };
      teams.set(opts.teamId, team);
    } else {
      if (!team.memberIds.includes(opts.agentId)) {
        team.memberIds.push(opts.agentId);
      }
    }
    if (opts.agentType === "team-lead") {
      team.leaderId = opts.agentId;
      team.status = "active";
    }
  }

  if (opts.parentId && !edges.some(e => e.source === opts.parentId && e.target === opts.agentId)) {
    edges.push({ source: opts.parentId, target: opts.agentId });
  }

  const event: AgentEvent = {
    type: "agent:register",
    agentId: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    task: agent.task,
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
  };
  broadcast({ type: "state:update", event, timestamp: Date.now() });
}

// ── Update team status based on member states ────────
export function updateTeamStatus(teamId: string) {
  const team = teams.get(teamId);
  if (!team) return;
  const members = team.memberIds.map(id => agents.get(id)).filter(Boolean);
  if (members.length === 0) return;
  const allCompleted = members.every(a => a!.status === "completed");
  const anyError = members.some(a => a!.status === "error");
  const anyRunning = members.some(a => a!.status === "running" || a!.status === "idle");
  if (anyError) team.status = "error";
  else if (allCompleted) team.status = "completed";
  else if (anyRunning) team.status = "active";
}

// ── Update agent status based on file recency ────────
export function updateAgentStatus(agentId: string, mtimeMs: number) {
  const agent = agents.get(agentId);
  if (!agent) return;

  const prev = agentLastModified.get(agentId) || 0;
  if (mtimeMs > prev) agentLastModified.set(agentId, mtimeMs);

  const timeSinceModified = Date.now() - mtimeMs;
  if (timeSinceModified < STATUS_RUNNING_THRESHOLD_MS) {
    if (agent.status !== "running") {
      agent.status = "running";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "running" },
        timestamp: Date.now(),
      });
    }
  } else if (timeSinceModified < STATUS_IDLE_THRESHOLD_MS) {
    if (agent.status === "running") {
      agent.status = "idle";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "idle" },
        timestamp: Date.now(),
      });
    }
  }
}

// ── Process a JSONL entry ──────────────────────────────
export function processEntry(entry: Record<string, unknown>, agentId: string, _sessionId: string) {
  const timestamp = typeof entry.timestamp === "string"
    ? new Date(entry.timestamp).getTime()
    : Date.now();

  const msg = entry.message;
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;

  const role = typeof message.role === "string" ? message.role : undefined;

  if (role === "assistant" && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use") continue;
      if (typeof b.name !== "string") continue;
      {
        const toolName = b.name;
        const input = b.input && typeof b.input === "object" ? b.input as Record<string, unknown> : undefined;
        let argsStr: string | undefined;
        if (input) {
          const keys = Object.keys(input);
          if (keys.length <= INLINE_ARGS_MAX_KEYS) {
            argsStr = keys
              .map((k) => {
                const v = input[k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s?.slice(0, MAX_ARG_PREVIEW_LENGTH)}`;
              })
              .join(", ");
          } else {
            argsStr = keys.join(", ");
          }
        }

        const event: AgentEvent = {
          type: "agent:tool_call",
          agentId,
          tool: toolName,
          args: argsStr,
        };

        const agent = agents.get(agentId);
        if (agent) {
          const tc: ToolCallEntry = { tool: toolName, args: argsStr, timestamp };
          agent.toolCalls.push(tc);
          if (agent.toolCalls.length > MAX_TOOL_CALLS_PER_AGENT) {
            agent.toolCalls = agent.toolCalls.slice(-MAX_TOOL_CALLS_PER_AGENT);
          }
          agent.status = "running";
        }

        broadcast({ type: "state:update", event, timestamp });
      }
    }

    const usage = message.usage;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, number>;
      const agent = agents.get(agentId);
      if (agent) {
        agent.inputTokens = (agent.inputTokens || 0) + (u.input_tokens || 0);
        agent.outputTokens = (agent.outputTokens || 0) + (u.output_tokens || 0);
        agent.cacheReadTokens = (agent.cacheReadTokens || 0) + (u.cache_read_input_tokens || 0);
        agent.cacheCreateTokens = (agent.cacheCreateTokens || 0) + (u.cache_creation_input_tokens || 0);

        const event: AgentEvent = {
          type: "agent:tokens",
          agentId,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          cacheReadTokens: agent.cacheReadTokens,
          cacheCreateTokens: agent.cacheCreateTokens,
          contextWindow: agent.contextWindow,
        };
        broadcast({ type: "state:update", event, timestamp });
      }
    }
  }
}
