import type { AgentEvent, ServerEvent, AgentStatus, AgentType } from "./types";

const AGENT_STATUSES: readonly AgentStatus[] = ["running", "waiting", "idle", "completed", "error"];
const AGENT_TYPES: readonly AgentType[] = ["main", "explore", "plan", "build", "review", "test", "team-lead", "generic"];

function isAgentStatus(v: unknown): v is AgentStatus {
  return typeof v === "string" && (AGENT_STATUSES as readonly string[]).includes(v);
}

function isAgentType(v: unknown): v is AgentType {
  return typeof v === "string" && (AGENT_TYPES as readonly string[]).includes(v);
}

/** Validate that a parsed object is a well-formed ServerEvent */
export function isValidServerEvent(data: unknown): data is ServerEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case "state:sync":
      // protocolVersion is optional for back-compat with pre-v1 servers; when
      // present it must be a number so the client can compare it to PROTOCOL_VERSION.
      return (
        Array.isArray(obj.agents) &&
        Array.isArray(obj.edges) &&
        Array.isArray(obj.teams) &&
        (obj.protocolVersion === undefined || typeof obj.protocolVersion === "number")
      );
    case "state:update":
      return typeof obj.timestamp === "number" && isValidAgentEvent(obj.event);
    case "state:remove":
      return typeof obj.agentId === "string";
    case "log:response":
      return typeof obj.agentId === "string" && Array.isArray(obj.entries);
    case "log:error":
      return typeof obj.agentId === "string" && typeof obj.error === "string";
    case "annotation:sync":
      return Array.isArray(obj.annotations);
    case "annotation:update":
      return obj.annotation != null && (obj.action === "add" || obj.action === "remove");
    default:
      return false;
  }
}

/** Validate that a parsed object is a well-formed AgentEvent */
export function isValidAgentEvent(data: unknown): data is AgentEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case "agent:register":
      return typeof obj.agentId === "string" && isAgentType(obj.agentType) && typeof obj.task === "string";
    case "agent:status":
      return typeof obj.agentId === "string" && isAgentStatus(obj.status);
    case "agent:tool_call":
      return typeof obj.agentId === "string" && typeof obj.tool === "string";
    case "agent:tokens":
      return typeof obj.agentId === "string" && typeof obj.inputTokens === "number";
    case "agent:message":
      return typeof obj.fromId === "string" && typeof obj.toId === "string";
    case "agent:complete":
      return typeof obj.agentId === "string" && typeof obj.duration === "number";
    default:
      return false;
  }
}
