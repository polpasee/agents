import { AGENT_STATUSES, AGENT_TYPES, THINKING_EFFORTS } from "./types";
import type {
  AgentEvent,
  ServerEvent,
  AgentStatus,
  AgentType,
  WorkflowRunState,
} from "./types";

function isAnnotationShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const ann = v as Record<string, unknown>;
  return (
    typeof ann.id === "string" &&
    typeof ann.targetId === "string" &&
    (ann.targetType === "agent" || ann.targetType === "edge") &&
    typeof ann.text === "string" &&
    typeof ann.timestamp === "number"
  );
}

function isWorkflowPhaseShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.index === "number" && typeof p.title === "string";
}

function isWorkflowAgentRefShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.agentId === "string" &&
    typeof r.label === "string" &&
    typeof r.state === "string"
  );
}

function isAgentStatus(v: unknown): v is AgentStatus {
  return (
    typeof v === "string" && (AGENT_STATUSES as readonly string[]).includes(v)
  );
}

function isAgentType(v: unknown): v is AgentType {
  return (
    typeof v === "string" && (AGENT_TYPES as readonly string[]).includes(v)
  );
}

function isWorkflowRunState(v: unknown): v is WorkflowRunState {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.runId === "string" &&
    typeof r.sessionId === "string" &&
    typeof r.name === "string" &&
    (r.status === "running" ||
      r.status === "completed" ||
      r.status === "failed") &&
    typeof r.startTime === "number" &&
    typeof r.agentCount === "number" &&
    Array.isArray(r.phases) &&
    r.phases.every(isWorkflowPhaseShape) &&
    Array.isArray(r.agents) &&
    r.agents.every(isWorkflowAgentRefShape)
  );
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
        (obj.protocolVersion === undefined ||
          typeof obj.protocolVersion === "number")
      );
    case "state:update":
      return typeof obj.timestamp === "number" && isValidAgentEvent(obj.event);
    case "state:remove":
      return typeof obj.agentId === "string";
    case "annotation:sync":
      return (
        Array.isArray(obj.annotations) &&
        obj.annotations.every(isAnnotationShape)
      );
    case "annotation:update":
      if (obj.action !== "add" && obj.action !== "remove") return false;
      return isAnnotationShape(obj.annotation);
    case "workflow:update":
      return isWorkflowRunState(obj.workflow);
    case "workflow:remove":
      return typeof obj.runId === "string";
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
      return (
        typeof obj.agentId === "string" &&
        isAgentType(obj.agentType) &&
        typeof obj.task === "string" &&
        // Optional fields: absent/undefined is valid; reject only wrong types.
        (obj.effort === undefined ||
          (THINKING_EFFORTS as readonly string[]).includes(
            obj.effort as string,
          )) &&
        (obj.is1MContext === undefined ||
          typeof obj.is1MContext === "boolean") &&
        (obj.parentId === undefined || typeof obj.parentId === "string") &&
        (obj.model === undefined || typeof obj.model === "string") &&
        (obj.displayType === undefined || typeof obj.displayType === "string")
      );
    case "agent:status":
      return typeof obj.agentId === "string" && isAgentStatus(obj.status);
    case "agent:tool_call":
      return typeof obj.agentId === "string" && typeof obj.tool === "string";
    case "agent:tokens":
      return (
        typeof obj.agentId === "string" &&
        Number.isFinite(obj.inputTokens) &&
        Number.isFinite(obj.outputTokens) &&
        Number.isFinite(obj.cacheReadTokens) &&
        Number.isFinite(obj.cacheCreateTokens) &&
        Number.isFinite(obj.contextWindow)
      );
    case "agent:message":
      return typeof obj.fromId === "string" && typeof obj.toId === "string";
    case "agent:complete":
      return (
        typeof obj.agentId === "string" && typeof obj.duration === "number"
      );
    default:
      return false;
  }
}
