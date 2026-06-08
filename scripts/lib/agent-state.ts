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
import { viewers, broadcast, type SSEClient } from "./sse-broadcast";

// Re-exports so call sites that already import from agent-state keep working.
export { viewers, broadcast };
export type { SSEClient };

// ── HMR-safe singleton state ─────────────────────────
// Stashed on globalThis so Next.js dev hot-reloads do not wipe accumulated
// agent state, the polling loops' "started" flag, or in-flight viewer set.
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
    started: boolean;
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
  started: false,
});

export const agents = store.agents;
export const edges = store.edges;
export const teams = store.teams;
export const agentLastModified = store.agentLastModified;
export const removedAgentIds = store.removedAgentIds;
export const agentFilePaths = store.agentFilePaths;
export const workflows = store.workflows;

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

/** Internal: exposed for instrumentation.ts to consult/mutate the started flag */
export function _backgroundStarted(): boolean { return store.started; }
export function _markBackgroundStarted(): void { store.started = true; }

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
    displayType: opts.displayType,
    task: agent.task,
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
    metadata: agent.metadata,
    effort: opts.effort,
    is1MContext: opts.is1MContext,
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
export function processEntry(entry: Record<string, unknown>, agentId: string, _sessionId: string) {
  // Defensive wrapper: the polling tick reads many JSONL entries and one bad
  // entry must not crash the whole loop. Malformed inputs (circular refs in
  // tool input, unexpected shapes) get logged and skipped.
  try {
    return processEntryInner(entry, agentId, _sessionId);
  } catch (err) {
    console.warn(`processEntry: failed to process entry for agent ${agentId}:`, err);
    return;
  }
}

// ── Background tasks ─────────────────────────────────
// Polling cadence and usage cache refresh were previously owned by the
// stand-alone ws-server process. After the SSE migration they run inside
// the Next.js process, started exactly once by src/instrumentation.ts.

import * as path from "node:path";
import * as os from "node:os";

export async function startBackgroundTasks(): Promise<void> {
  if (_backgroundStarted()) return;

  // Flip the started flag only AFTER all dynamic imports resolve. If any
  // import rejects, the flag stays false so a later caller can retry —
  // previously a failed import would permanently wedge polling off.
  const { discoverActiveSessions } = await import("./discovery");
  const { POLL_INTERVAL_MS, USAGE_REFRESH_INTERVAL_MS, USAGE_REFRESH_THRESHOLD_MS } = await import("./config");
  const { readCacheMtime, triggerCcstatuslineRefresh } = await import("./ccstatusline");
  const { loadWebhookConfig } = await import("./webhooks");

  const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

  loadWebhookConfig();

  console.log(`[bg] Agent Monitor background tasks starting`);
  console.log(`[bg] Watching: ${PROJECTS_DIR}`);
  console.log(`[bg] Poll interval: ${POLL_INTERVAL_MS}ms`);

  let firstRun = true;
  async function pollLoop(): Promise<void> {
    try {
      await discoverActiveSessions(PROJECTS_DIR);
      if (firstRun) {
        firstRun = false;
        console.log(`[bg] Found ${agents.size} active agent(s)`);
      }
    } catch (err) {
      console.warn("[bg poll] discovery failed:", err);
    } finally {
      setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  }

  async function usagePollLoop(): Promise<void> {
    try {
      const mtime = readCacheMtime();
      if (mtime === null || Date.now() - mtime > USAGE_REFRESH_THRESHOLD_MS) {
        triggerCcstatuslineRefresh();
      }
    } catch (err) {
      console.warn("[bg usage] refresh failed:", err);
    } finally {
      setTimeout(usagePollLoop, USAGE_REFRESH_INTERVAL_MS);
    }
  }

  _markBackgroundStarted();
  pollLoop();
  usagePollLoop();
}

function processEntryInner(entry: Record<string, unknown>, agentId: string, _sessionId: string) {
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
      broadcast({
        type: "state:update",
        event: {
          type: "agent:register",
          agentId,
          agentType: agent.agentType,
          displayType: agent.displayType,
          task: agent.task,
          sessionId: agent.sessionId,
          slug: agent.slug,
          model: modelField,
          teamId: agent.teamId,
          parentId: agent.parentId,
          metadata: agent.metadata,
          effort: agent.effort,
          is1MContext: agent.is1MContext,
        },
        timestamp,
      });
    }
  }

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

