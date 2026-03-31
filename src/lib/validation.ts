import type { AgentEvent, ServerEvent } from "./types";

/** Validate that a parsed object is a well-formed ServerEvent */
export function isValidServerEvent(data: unknown): data is ServerEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case "state:sync":
      return Array.isArray(obj.agents) && Array.isArray(obj.edges) && Array.isArray(obj.teams);
    case "state:update":
      return typeof obj.timestamp === "number" && isValidAgentEvent(obj.event);
    case "state:remove":
      return typeof obj.agentId === "string";
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
      return typeof obj.agentId === "string" && typeof obj.agentType === "string" && typeof obj.task === "string";
    case "agent:status":
      return typeof obj.agentId === "string" && typeof obj.status === "string";
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

/** Sanitize a string for safe display (strip HTML tags, limit length) */
export function sanitizeDisplayText(text: string, maxLength = 500): string {
  return text.replace(/<[^>]*>/g, "").slice(0, maxLength);
}
