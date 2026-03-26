import { WebSocket } from "ws";
import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  ToolCallEntry,
} from "../../src/lib/types";

// ── State ──────────────────────────────────────────────
export const agents = new Map<string, AgentState>();
export const edges: EdgeState[] = [];
export const viewers = new Set<WebSocket>();
export const agentLastModified = new Map<string, number>();
export const removedAgentIds = new Set<string>();

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

  if (opts.parentId && agents.has(opts.parentId)) {
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
  };
  broadcast({ type: "state:update", event, timestamp: Date.now() });
}

// ── Update agent status based on file recency ────────
export function updateAgentStatus(agentId: string, mtimeMs: number) {
  const agent = agents.get(agentId);
  if (!agent) return;

  const prev = agentLastModified.get(agentId) || 0;
  if (mtimeMs > prev) agentLastModified.set(agentId, mtimeMs);

  const timeSinceModified = Date.now() - mtimeMs;
  if (timeSinceModified < 10000) {
    if (agent.status !== "running") {
      agent.status = "running";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "running" },
        timestamp: Date.now(),
      });
    }
  } else if (timeSinceModified < 60000) {
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
  const timestamp = entry.timestamp
    ? new Date(entry.timestamp as string).getTime()
    : Date.now();

  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return;

  const role = msg.role as string | undefined;

  if (role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content as Record<string, unknown>[]) {
      if (block.type === "tool_use") {
        const toolName = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        let argsStr: string | undefined;
        if (input) {
          const keys = Object.keys(input);
          if (keys.length <= 2) {
            argsStr = keys
              .map((k) => {
                const v = input[k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s?.slice(0, 60)}`;
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
          if (agent.toolCalls.length > 20) {
            agent.toolCalls = agent.toolCalls.slice(-20);
          }
          agent.status = "running";
        }

        broadcast({ type: "state:update", event, timestamp });
      }
    }

    const usage = msg.usage as Record<string, number> | undefined;
    if (usage) {
      const agent = agents.get(agentId);
      if (agent) {
        agent.inputTokens = (agent.inputTokens || 0) + (usage.input_tokens || 0);
        agent.outputTokens = (agent.outputTokens || 0) + (usage.output_tokens || 0);
        agent.cacheReadTokens = (agent.cacheReadTokens || 0) + (usage.cache_read_input_tokens || 0);
        agent.cacheCreateTokens = (agent.cacheCreateTokens || 0) + (usage.cache_creation_input_tokens || 0);

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
