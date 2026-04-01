import type { AgentEvent, ServerEvent, ClientEvent } from "./types";

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

/** Validate a client-to-server event */
export function isValidClientEvent(data: unknown): data is ClientEvent {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  switch (obj.type) {
    case "log:request":
      return typeof obj.agentId === "string";
    case "annotation:add":
      return obj.annotation != null && typeof obj.annotation === "object";
    case "annotation:remove":
      return typeof obj.annotationId === "string";
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