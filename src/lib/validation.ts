import type { AgentEvent, ServerEvent, AgentStatus, AgentType, WorkflowRunState } from "./types";

function isAnnotationShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const ann = v as Record<string, unknown>;
  return typeof ann.id === "string" && typeof ann.targetId === "string";
}

const AGENT_STATUSES: readonly AgentStatus[] = ["running", "waiting", "idle", "completed", "error"];
const AGENT_TYPES: readonly AgentType[] = ["main", "explore", "plan", "build", "review", "test", "team-lead", "generic"];

function isAgentStatus(v: unknown): v is AgentStatus {
  return typeof v === "string" && (AGENT_STATUSES as readonly string[]).includes(v);
}

function isAgentType(v: unknown): v is AgentType {
  return typeof v === "string" && (AGENT_TYPES as readonly string[]).includes(v);
}

function isWorkflowRunState(v: unknown): v is WorkflowRunState {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.runId === "string" &&
    typeof r.sessionId === "string" &&
    typeof r.name === "string" &&
    (r.status === "running" || r.status === "completed" || r.status === "failed") &&
    typeof r.startTime === "number" &&
    typeof r.agentCount === "number" &&
    Array.isArray(r.phases) &&
    Array.isArray(r.agents)
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
        (obj.protocolVersion === undefined || typeof obj.protocolVersion === "number")
      );
    case "state:update":
      return typeof obj.timestamp === "number" && isValidAgentEvent(obj.event);
    case "state:remove":
      return typeof obj.agentId === "string";
    case "annotation:sync":
      return Array.isArray(obj.annotations) && obj.annotations.every(isAnnotationShape);
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
