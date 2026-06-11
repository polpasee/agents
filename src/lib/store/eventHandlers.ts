import type {
  AgentEvent,
  AgentState,
  EdgeState,
  ErrorDetail,
  TeamState,
  ToolCallEntry,
  AgentTypeBudgets,
} from "../types";
import { TOOL_CALLS_MAX_PER_AGENT, DEFAULT_CONTEXT_WINDOW } from "../config";
import { findCascadeRelations, recomputeTeamForAgent } from "./helpers";

/**
 * Mutation context shared by every per-event handler. Preserves the lazy-clone
 * semantic from PR #6: the dispatcher reads the prior store snapshot once;
 * handlers call `cloneAgents()` (or peer cloners) only when they actually
 * mutate that field. The dispatcher's trailing `set()` then conditionally
 * commits each clone.
 *
 * `topologyDirty` is set by handlers when the rendered graph shape changes.
 */
export interface MutationContext {
  // Prior snapshot (read-only inside handlers — do NOT mutate these).
  readonly agents: Map<string, AgentState>;
  readonly edges: EdgeState[];
  readonly errorDetails: Map<string, ErrorDetail>;
  readonly teams: Map<string, TeamState>;
  readonly agentTypeBudgets: AgentTypeBudgets;

  // Lazy clones (null until first cloneX() call).
  newAgents: Map<string, AgentState> | null;
  newEdges: EdgeState[];
  newErrorDetails: Map<string, ErrorDetail> | null;
  newTeams: Map<string, TeamState> | null;
  topologyDirty: boolean;

  cloneAgents: () => Map<string, AgentState>;
  /** Currently-effective agents Map (lazy clone if mutated, else snapshot). */
  effectiveAgents: () => Map<string, AgentState>;
}

export function createMutationContext(snapshot: {
  agents: Map<string, AgentState>;
  edges: EdgeState[];
  errorDetails: Map<string, ErrorDetail>;
  teams: Map<string, TeamState>;
  agentTypeBudgets: AgentTypeBudgets;
}): MutationContext {
  const ctx: MutationContext = {
    agents: snapshot.agents,
    edges: snapshot.edges,
    errorDetails: snapshot.errorDetails,
    teams: snapshot.teams,
    agentTypeBudgets: snapshot.agentTypeBudgets,
    newAgents: null,
    newEdges: snapshot.edges,
    newErrorDetails: null,
    newTeams: null,
    topologyDirty: false,
    cloneAgents() {
      return (this.newAgents ??= new Map(this.agents));
    },
    effectiveAgents() {
      return this.newAgents ?? this.agents;
    },
  };
  return ctx;
}

// ── Re-register (metadata refresh) field-merge strategies ────────────
//
// When an already-live agent sends a second agent:register, we merge the
// event's fields into the existing state without wiping accumulated data
// (toolCalls, tokens, startTime, etc. come from `...existing` spread).
//
// Three merge strategies (applied per-field in applyRegister):
//   incoming        — event.x || existing.x  (truthy incoming wins; model
//                     additionally carries a "" final fallback)
//   incomingNullish — event.x ?? existing.x  (nullish-check: even
//                     false/0 from the event replaces the existing value)
//   keepFirst       — existing.x || event.x  (once set, never replaced)
//
// Adding a new AgentState field? Add it to the merge block in applyRegister
// so the policy is explicit.

// ── Per-event handlers ────────────────────────────────────────────────

export function applyRegister(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:register" }>,
  timestamp: number,
): void {
  // If the agent is already live, treat register as a metadata
  // refresh — fill in missing fields (e.g. model learned lazily)
  // without wiping accumulated state like toolCalls or tokens.
  const existing = ctx.agents.get(event.agentId);
  const agent: AgentState = existing
    ? {
        ...existing,
        // incoming: truthy event value wins.
        model:       event.model || existing.model || "",      // label must reflect live model switches
        agentType:   event.agentType || existing.agentType,    // coarse type can be corrected on refresh
        parentId:    event.parentId || existing.parentId,      // re-parent broadcast for nested sub-agents
        // keepFirst: once set, never replaced.
        task:        existing.task || event.task,              // first task description wins
        slug:        existing.slug || event.slug,              // stable identifier once assigned
        displayType: existing.displayType || event.displayType, // display label set on first register
        metadata:    existing.metadata || event.metadata,      // arbitrary bag; keep original contents
        // incomingNullish: even false/0 from the event replaces the value.
        effort:      event.effort ?? existing.effort,           // settings.json may omit effort on refresh
        is1MContext: event.is1MContext ?? existing.is1MContext, // same: false is meaningful, not "absent"
      }
    : {
        id: event.agentId,
        parentId: event.parentId,
        agentType: event.agentType,
        displayType: event.displayType,
        status: "running",
        task: event.task,
        sessionId: event.sessionId,
        slug: event.slug,
        model: event.model,
        teamId: event.teamId,
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        startTime: timestamp,
        metadata: event.metadata,
        effort: event.effort,
        is1MContext: event.is1MContext,
      };
  ctx.cloneAgents().set(event.agentId, agent);

  // New agent = topology change. A metadata-refresh re-register on an
  // already-known agent only counts as a topology change if its
  // parentId or teamId moved (extremely rare in practice).
  if (!existing) {
    ctx.topologyDirty = true;
  } else if (existing.parentId !== agent.parentId || existing.teamId !== agent.teamId) {
    ctx.topologyDirty = true;
  }

  // Re-parent on refresh: swap the agent's parent edge (the edge with no
  // edgeType targeting it) to hang off the new parent.
  if (existing && agent.parentId && existing.parentId !== agent.parentId) {
    ctx.newEdges = [
      ...ctx.newEdges.filter(e => !(e.target === event.agentId && !e.edgeType)),
      { source: agent.parentId, target: event.agentId },
    ];
  }

  // Edge and team membership only on first register — avoids duplicate
  // edges when register is replayed as a metadata refresh.
  if (!existing) {
    if (event.parentId) {
      ctx.newEdges = [...ctx.newEdges, { source: event.parentId, target: event.agentId }];
    }
    if (event.teamId) {
      const newTeams = new Map(ctx.teams);
      let team = newTeams.get(event.teamId);
      if (!team) {
        team = {
          id: event.teamId,
          name: event.teamId,
          memberIds: [event.agentId],
          status: "forming",
          task: event.task,
          startTime: timestamp,
        };
      } else {
        team = { ...team, memberIds: [...team.memberIds, event.agentId] };
      }
      if (event.agentType === "team-lead") {
        team = { ...team, leaderId: event.agentId, status: "active" };
      }
      newTeams.set(event.teamId, team);
      ctx.newTeams = newTeams;
    }
  }
}

export function applyStatus(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:status" }>,
  timestamp: number,
): void {
  const agent = ctx.agents.get(event.agentId);
  if (agent) {
    const updates: Partial<AgentState> = { status: event.status };
    // F1: dependency tracking
    if (event.waitingOn) {
      updates.waitingOn = event.waitingOn;
      const blockingEdge: EdgeState = { source: event.waitingOn, target: event.agentId, edgeType: "blocking" };
      if (!ctx.newEdges.some(e => e.source === event.waitingOn && e.target === event.agentId && e.edgeType === "blocking")) {
        ctx.newEdges = [...ctx.newEdges, blockingEdge];
        ctx.topologyDirty = true;
      }
    } else if (agent.waitingOn && event.status !== "waiting") {
      // Clear blocking edge when no longer waiting
      updates.waitingOn = undefined;
      ctx.newEdges = ctx.newEdges.filter(e => !(e.target === event.agentId && e.edgeType === "blocking"));
      ctx.topologyDirty = true;
    }
    // F2: error detail extraction
    //
    // Semantic of `cascadeIds` for an agent X (verified against
    // ErrorDrillDown.tsx — "ERROR CASCADE" panel): the descendants of X
    // that errored after X did. So when X errors NOW we only need to:
    //   (a) record X's own ErrorDetail (with an empty cascade — no
    //       descendants have errored AFTER X yet at this moment), and
    //   (b) walk every already-errored ancestor A and append X to A's
    //       cascadeIds iff X is a descendant of A. (See findCascadeRelations.)
    if (event.status === "error") {
      const lastTool = agent.toolCalls.length > 0 ? agent.toolCalls[agent.toolCalls.length - 1] : undefined;

      const cascadeUpdate = findCascadeRelations(event.agentId, ctx.agents, ctx.errorDetails);
      ctx.newErrorDetails = cascadeUpdate ?? ctx.newErrorDetails ?? new Map(ctx.errorDetails);
      ctx.newErrorDetails.set(event.agentId, {
        agentId: event.agentId,
        message: event.message || "Agent encountered an error",
        lastToolCall: lastTool,
        cascadeIds: [],
        timestamp,
      });
    }
    ctx.cloneAgents().set(event.agentId, { ...agent, ...updates });
  }
  const teamsUpdate = recomputeTeamForAgent(event.agentId, ctx.effectiveAgents(), ctx.teams);
  if (teamsUpdate) ctx.newTeams = teamsUpdate;
}

export function applyToolCall(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:tool_call" }>,
  timestamp: number,
): void {
  const agent = ctx.agents.get(event.agentId);
  if (!agent) return;
  const entry: ToolCallEntry = {
    tool: event.tool,
    args: event.args,
    result: event.result,
    timestamp,
  };
  const toolCalls = [...agent.toolCalls, entry].slice(-TOOL_CALLS_MAX_PER_AGENT);
  ctx.cloneAgents().set(event.agentId, { ...agent, toolCalls });
}

export function applyTokens(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:tokens" }>,
): void {
  const agent = ctx.agents.get(event.agentId);
  // Note: tokens for an unknown agent is a no-op — we deliberately do NOT
  // clone the Map in that branch. This is the hottest path during
  // steady-state, so it must stay free.
  if (!agent) return;
  const totalTokens = event.inputTokens + event.outputTokens;
  // F3: check token budget
  const budgetLimit = ctx.agentTypeBudgets[agent.agentType];
  const budgetExceeded = budgetLimit != null && totalTokens > budgetLimit;
  ctx.cloneAgents().set(event.agentId, {
    ...agent,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreateTokens: event.cacheCreateTokens,
    contextWindow: event.contextWindow,
    budgetExceeded,
  });
}

export function applyComplete(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:complete" }>,
): void {
  const agent = ctx.agents.get(event.agentId);
  if (agent) {
    ctx.cloneAgents().set(event.agentId, {
      ...agent,
      status: "completed",
      duration: event.duration,
      summary: event.summary,
      waitingOn: undefined,
    });
    // Clear any blocking edges
    const beforeLen = ctx.newEdges.length;
    ctx.newEdges = ctx.newEdges.filter(e => !(e.target === event.agentId && e.edgeType === "blocking"));
    if (ctx.newEdges.length !== beforeLen) ctx.topologyDirty = true;
  }
  const teamsUpdate = recomputeTeamForAgent(event.agentId, ctx.effectiveAgents(), ctx.teams);
  if (teamsUpdate) ctx.newTeams = teamsUpdate;
}

export function applyMessage(
  ctx: MutationContext,
  event: Extract<AgentEvent, { type: "agent:message" }>,
): void {
  // Only mutates `edges`, never `agents` — Map identity stays stable.
  const messageEdge = { source: event.fromId, target: event.toId, edgeType: "message" as const };
  if (!ctx.newEdges.some(e => e.source === event.fromId && e.target === event.toId && e.edgeType === "message")) {
    ctx.newEdges = [...ctx.newEdges, messageEdge];
    ctx.topologyDirty = true;
  }
}
