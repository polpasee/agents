/**
 * Shared AgentState factory
 * ─────────────────────────
 * Single source of truth for constructing the initial AgentState when an
 * agent registers for the first time. Both the server-side watcher
 * (scripts/lib/agent-state.ts) and the client-side store handler
 * (src/lib/store/eventHandlers.ts) call this instead of duplicating the
 * field-default set.
 *
 * Import-safety: this module pulls in ONLY pure constants and types —
 * no browser APIs, no heavy deps — so it is safe for the Node/server tier.
 */
import type { AgentState, AgentType, ThinkingEffort } from "./types";
import { DEFAULT_CONTEXT_WINDOW } from "./config";

export interface MakeAgentStateOpts {
  id: string;
  parentId?: string | undefined;
  agentType: AgentType;
  displayType?: string | undefined;
  task: string;
  sessionId?: string | undefined;
  slug?: string | undefined;
  model?: string | undefined;
  teamId?: string | undefined;
  startTime: number;
  metadata?: Record<string, unknown> | undefined;
  effort?: ThinkingEffort | undefined;
  is1MContext?: boolean | undefined;
  workflowName?: string | undefined;
}

/**
 * Construct a fully-defaulted AgentState for a newly-registering agent.
 *
 * Accumulated fields (toolCalls, tokens, status) are set to their zero
 * values here. The caller may spread-override any field after the call if
 * a specific registration site needs a different starting value.
 */
export function makeAgentState(opts: MakeAgentStateOpts): AgentState {
  return {
    id: opts.id,
    parentId: opts.parentId,
    agentType: opts.agentType,
    displayType: opts.displayType,
    status: "running",
    task: opts.task,
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    startTime: opts.startTime,
    metadata: opts.metadata,
    effort: opts.effort,
    is1MContext: opts.is1MContext,
    workflowName: opts.workflowName,
  };
}
