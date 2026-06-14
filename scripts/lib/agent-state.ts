import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  TeamState,
  ThinkingEffort,
  ToolCallEntry,
  WorkflowRunState,
} from "../../src/lib/types";
import {
  STATUS_RUNNING_THRESHOLD_MS,
  MAX_TOOL_CALLS_PER_AGENT,
  INLINE_ARGS_MAX_KEYS,
  MAX_ARG_PREVIEW_LENGTH,
} from "./config";
import { viewers, broadcast } from "./sse-broadcast";

// Re-exports so call sites that already import from agent-state keep working.
export { viewers, broadcast };

// ── HMR-safe singleton state ─────────────────────────
// Stashed on globalThis so Next.js dev hot-reloads do not wipe accumulated
// agent state or the in-flight viewer set.
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorState: {
    agents: Map<string, AgentState>;
    edges: EdgeState[];
    teams: Map<string, TeamState>;
    workflows: Map<string, WorkflowRunState>;
    agentLastModified: Map<string, number>;
    removedAgentIds: Map<string, number>;
    agentFilePaths: Map<string, string>;
    spawnIndex: Map<string, string>;
    pendingReparents: Map<string, string>;
  } | undefined;
}

const store = (globalThis.__agentMonitorState ??= {
  agents: new Map<string, AgentState>(),
  edges: [] as EdgeState[],
  teams: new Map<string, TeamState>(),
  workflows: new Map<string, WorkflowRunState>(),
  agentLastModified: new Map<string, number>(),
  removedAgentIds: new Map<string, number>(),
  agentFilePaths: new Map<string, string>(),
  spawnIndex: new Map<string, string>(),
  pendingReparents: new Map<string, string>(),
});
// A dev process may have created the singleton before newer fields existed;
// hot-reload reuses that object, so backfill anything missing.
store.spawnIndex ??= new Map<string, string>();
store.pendingReparents ??= new Map<string, string>();

export const agents = store.agents;
export const edges = store.edges;
export const teams = store.teams;
export const agentLastModified = store.agentLastModified;
export const removedAgentIds = store.removedAgentIds;
export const agentFilePaths = store.agentFilePaths;
export const workflows = store.workflows;
export const spawnIndex = store.spawnIndex;
export const pendingReparents = store.pendingReparents;

export function upsertWorkflow(run: WorkflowRunState): void {
  workflows.set(run.runId, run);
  broadcast({ type: "workflow:update", workflow: run });
}

export function removeWorkflow(runId: string): void {
  workflows.delete(runId);
  broadcast({ type: "workflow:remove", runId });
}

/** Get the JSONL file path for an agent */
export function getAgentFilePath(agentId: string): string | undefined {
  return agentFilePaths.get(agentId);
}

// ── Parse agent type from meta.json or slug ────────────
export function parseAgentType(raw?: string): AgentType {
  if (!raw) return "generic";
  const lower = raw.toLowerCase();

  if (lower.includes("team-lead")) return "team-lead";
  // Compound names must resolve before their component words fire elsewhere
  if (lower.includes("code-architect") || lower.includes("code-simplifier")) return "build";
  // "analyzer" (review tool) must precede the "analy" → explore catch-all below
  // "failure-hunter" and "auditor" are review signals
  if (lower.includes("review") || lower.includes("audit") || lower.includes("critic")
      || lower.includes("analyzer") || lower.includes("failure-hunter")) return "review";
  // \bqa\b(?!-) avoids matching "qa-sec" namespace segments; qa as a trailing role still matches
  if (lower.includes("test") || /\bqa\b(?!-)/.test(lower)) return "test";
  if (lower.includes("explore") || lower.includes("research")
      || lower.includes("analy") || lower.includes("investigat")
      || /\breader\b/.test(lower)) return "explore";
  // "ui-designer" carve-out: listed under Build in the cheatsheet; must come before
  // the generic "design" → plan rule that would otherwise capture it
  if (lower.includes("plan") || (lower.includes("architect") && !lower.includes("code-architect"))
      || (lower.includes("design") && !lower.includes("ui-designer"))) return "plan";
  if (lower.includes("build") || lower.includes("frontend") || lower.includes("backend")
      || lower.includes("implement") || lower.includes("migrat") || lower.includes("debug")
      || /\bfix\b/.test(lower) || /\bapi\b/.test(lower) || /\bui\b/.test(lower)
      || lower.includes("engineer") || lower.includes("specialist") || lower.includes("developer")
      || lower.includes("optimizer") || lower.includes("expert") || lower.includes("designer")
      || /-pro\b/.test(lower)) return "build";

  return "generic";
}

// ── Spawn index: tool_use id → spawning agent ─────────
// A nested sub-agent's meta.json carries the toolUseId of the `Agent`/`Task`
// tool_use block that spawned it; that block lives in the spawner's JSONL.
// Recording every spawn block's owner here is what lets discovery resolve a
// child's real parent instead of anchoring it to the main session.

/** Record the spawning agent for a single Agent/Task tool_use block. */
function recordSpawnToolUse(block: Record<string, unknown>, agentId: string): void {
  if (block.type !== "tool_use") return;
  if (block.name !== "Agent" && block.name !== "Task") return;
  if (typeof block.id !== "string" || block.id.length === 0) return;
  // First write wins: forked/resumed sessions replay the original
  // transcript's spawn lines verbatim, and a later harvest must not steal
  // ownership from the agent that actually issued the call.
  if (spawnIndex.has(block.id)) return;
  spawnIndex.set(block.id, agentId);
}

/**
 * Phase-A harvest: record Agent/Task spawn tool_use ids from an
 * already-parsed JSONL entry. Discovery runs this over every fresh
 * sub-agent file before registering anything, so the index is complete
 * even when readdir lists a child before its spawner.
 */
export function harvestSpawnToolUses(entry: Record<string, unknown>, agentId: string): void {
  const msg = entry.message;
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block && typeof block === "object") {
      recordSpawnToolUse(block as Record<string, unknown>, agentId);
    }
  }
}

/** Resolve which agent emitted the given spawn tool_use id, if known. */
export function resolveSpawnOwner(toolUseId: string): string | undefined {
  return spawnIndex.get(toolUseId);
}

/**
 * Resolve a spawn tool_use id to a spawner that is usable as `selfId`'s
 * parent: known, not the agent itself, and accepted by `isLive` (registered
 * agents by default; discovery's dependency sort passes the tick's batch).
 * All parent-resolution sites must go through this so the guards never drift.
 */
export function resolveLiveSpawner(
  toolUseId: string,
  selfId: string,
  isLive: (id: string) => boolean = (id) => agents.has(id),
): string | undefined {
  const owner = spawnIndex.get(toolUseId);
  if (owner === undefined || owner === selfId || !isLive(owner)) return undefined;
  return owner;
}

/** Drop spawn-index entries owned by a purged agent. */
export function dropSpawnEntriesFor(agentId: string): void {
  for (const [toolUseId, owner] of spawnIndex) {
    if (owner === agentId) spawnIndex.delete(toolUseId);
  }
}

// ── Register an agent and broadcast ──────────────────
export function registerAgent(opts: {
  agentId: string;
  sessionId: string;
  projectDir: string;
  agentType: AgentType;
  displayType?: string;
  parentId?: string;
  task: string;
  slug: string;
  model: string;
  startTime: number;
  teamId?: string;
  teamName?: string;
  effort?: ThinkingEffort;
  is1MContext?: boolean;
  workflowName?: string;
}) {
  // macOS resolves /tmp, /var, /etc through /private/* symlinks, so cwds there
  // are stored on disk as `-private-tmp` etc. Strip the cosmetic prefix from
  // the *label* only — projectDir keeps the canonical path for de-duplication.
  const projectName = opts.projectDir
    .replace(/-/g, "/")
    .replace(/^\//, "")
    .replace(/^private\/(tmp|var|etc)\b/, "$1");

  const agent: AgentState = {
    id: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    displayType: opts.displayType,
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
    effort: opts.effort,
    is1MContext: opts.is1MContext,
    workflowName: opts.workflowName,
  };

  agents.set(opts.agentId, agent);

  // A resurrected agent's children kept their parentId across the purge,
  // but the purge spliced their edges — restore them so the edges array
  // (and state:sync snapshots built from it) stays consistent with parentId.
  for (const [id, existing] of agents) {
    if (existing.parentId !== opts.agentId) continue;
    if (!edges.some(e => !e.edgeType && e.source === opts.agentId && e.target === id)) {
      edges.push({ source: opts.agentId, target: id });
    }
  }

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
    displayType: opts.displayType,
    task: agent.task,
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
    metadata: agent.metadata,
    effort: opts.effort,
    is1MContext: opts.is1MContext,
    workflowName: opts.workflowName,
  };
  broadcast({ type: "state:update", event, timestamp: Date.now() });
}

// Single builder for mid-session agent:register re-broadcasts (model
// change, re-parent, discovery's late-meta heal), deriving the event from
// stored state so a new AgentState field only needs adding here.
export function broadcastRegisterFor(agent: AgentState, timestamp: number): void {
  broadcast({
    type: "state:update",
    event: {
      type: "agent:register",
      agentId: agent.id,
      agentType: agent.agentType,
      displayType: agent.displayType,
      task: agent.task,
      sessionId: agent.sessionId,
      slug: agent.slug,
      model: agent.model,
      teamId: agent.teamId,
      parentId: agent.parentId,
      metadata: agent.metadata,
      effort: agent.effort,
      is1MContext: agent.is1MContext,
      workflowName: agent.workflowName,
    },
    timestamp,
  });
}

// ── Re-parent an agent onto its real spawner ──────────
// Used when a nested sub-agent registered against the session fallback and
// the spawn index later resolved its true parent (cross-tick race).
export function reparentAgent(agentId: string, newParentId: string): void {
  const agent = agents.get(agentId);
  if (!agent || agent.parentId === newParentId) return;

  // Refuse a re-parent that would close a parentId cycle (corrupt or
  // duplicated tool_use ids): walking up from the new parent must not
  // reach the agent being moved.
  let cursorId: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cursorId !== undefined && !seen.has(cursorId)) {
    if (cursorId === agentId) return;
    seen.add(cursorId);
    cursorId = agents.get(cursorId)?.parentId;
  }

  const oldParentId = agent.parentId;
  agent.parentId = newParentId;

  // Swap the parent edge: drop the old anchor, add the new one. Typed
  // edges (blocking/tool) are not parent anchors and must survive.
  for (let i = edges.length - 1; i >= 0; i--) {
    if (!edges[i].edgeType && edges[i].source === oldParentId && edges[i].target === agentId) {
      edges.splice(i, 1);
    }
  }
  if (!edges.some(e => !e.edgeType && e.source === newParentId && e.target === agentId)) {
    edges.push({ source: newParentId, target: agentId });
  }

  // Re-broadcast registration so connected dashboards adopt the new parent
  // (mirrors the mid-session model-change re-broadcast in processEntryInner).
  broadcastRegisterFor(agent, Date.now());
}

// ── Update agent status based on file recency ────────
export function updateAgentStatus(agentId: string, mtimeMs: number) {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Status reflects activity across ANY file we watch for this agent (main
  // JSONL + each sub-agent JSONL). Discovery calls us multiple times per poll
  // with different mtimes; we must decide based on the freshest write seen so
  // far, otherwise a later stale call clobbers an earlier fresh one and we
  // flip idle↔running every poll cycle.
  const prev = agentLastModified.get(agentId) || 0;
  const effectiveMtime = Math.max(mtimeMs, prev);
  agentLastModified.set(agentId, effectiveMtime);

  const timeSinceModified = Date.now() - effectiveMtime;
  if (timeSinceModified < STATUS_RUNNING_THRESHOLD_MS) {
    if (agent.status !== "running") {
      agent.status = "running";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "running" },
        timestamp: Date.now(),
      });
    }
  } else if (agent.status === "running") {
    // Any mtime age beyond RUNNING_THRESHOLD demotes to idle. Previously we
    // only transitioned inside the narrow 45-60s window, so an agent first
    // observed with an already-old mtime stayed stuck on "running" forever.
    agent.status = "idle";
    broadcast({
      type: "state:update",
      event: { type: "agent:status", agentId, status: "idle" },
      timestamp: Date.now(),
    });
  }
}

// ── Process a JSONL entry ──────────────────────────────
export function processEntry(entry: Record<string, unknown>, agentId: string) {
  // Defensive wrapper: the polling tick reads many JSONL entries and one bad
  // entry must not crash the whole loop. Malformed inputs (circular refs in
  // tool input, unexpected shapes) get logged and skipped.
  try {
    return processEntryInner(entry, agentId);
  } catch (err) {
    console.warn(`processEntry: failed to process entry for agent ${agentId}:`, err);
    return;
  }
}

function processEntryInner(entry: Record<string, unknown>, agentId: string) {
  const timestamp = typeof entry.timestamp === "string"
    ? new Date(entry.timestamp).getTime()
    : Date.now();

  const msg = entry.message;
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;

  const role = typeof message.role === "string" ? message.role : undefined;

  // Track the model from every assistant message — users can switch models
  // mid-session (e.g. Sonnet → Opus), and we want the label to reflect what
  // Claude is *currently* running, not whatever it was when the session
  // opened. Only broadcast when the value actually changes.
  const modelField = message.model;
  if (typeof modelField === "string" && modelField.length > 0) {
    const agent = agents.get(agentId);
    if (agent && agent.model !== modelField) {
      agent.model = modelField;
      broadcastRegisterFor(agent, timestamp);
    }
  }

  if (role === "assistant" && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use") continue;
      if (typeof b.name !== "string") continue;
      // Agent/Task tool_use blocks are spawn points — index them so nested
      // sub-agents can resolve their real parent (meta.toolUseId).
      recordSpawnToolUse(b, agentId);
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
                let s: string;
                if (typeof v === "string") {
                  s = v;
                } else {
                  try {
                    s = JSON.stringify(v);
                  } catch {
                    // Circular references / non-serializable values must
                    // not crash the whole entry. Show a placeholder so the
                    // tool call is still recorded.
                    s = "[unserializable]";
                  }
                }
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

