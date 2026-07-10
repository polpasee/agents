import type {
  AgentEvent,
  AgentState,
  AgentType,
  ThinkingEffort,
} from "../../src/lib/types";
import { makeAgentState } from "../../src/lib/agentState";
import { STATUS_RUNNING_THRESHOLD_MS } from "./config";
import { broadcast } from "./sse-broadcast";
import { agents, edges, teams, agentLastModified } from "./agent-store";
import { flushPendingTokens } from "./push-ingest";

// ── Register an agent and broadcast ──────────────────
export function registerAgent(opts: {
  agentId: string;
  sessionId: string;
  projectDir: string;
  agentType: AgentType;
  displayType?: string | undefined;
  parentId?: string | undefined;
  task: string;
  slug: string;
  model: string;
  startTime: number;
  teamId?: string | undefined;
  teamName?: string | undefined;
  effort?: ThinkingEffort | undefined;
  is1MContext?: boolean | undefined;
  workflowName?: string | undefined;
}) {
  // macOS resolves /tmp, /var, /etc through /private/* symlinks, so cwds there
  // are stored on disk as `-private-tmp` etc. Strip the cosmetic prefix from
  // the *label* only — projectDir keeps the canonical path for de-duplication.
  const projectName = opts.projectDir
    .replace(/-/g, "/")
    .replace(/^\//, "")
    .replace(/^private\/(tmp|var|etc)\b/, "$1");

  const agent: AgentState = makeAgentState({
    id: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    displayType: opts.displayType,
    task: opts.task || "Session",
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    teamId: opts.teamId,
    startTime: opts.startTime,
    metadata: { projectName, projectDir: opts.projectDir },
    effort: opts.effort,
    is1MContext: opts.is1MContext,
    workflowName: opts.workflowName,
  });

  agents.set(opts.agentId, agent);

  // A resurrected agent's children kept their parentId across the purge,
  // but the purge spliced their edges — restore them so the edges array
  // (and state:sync snapshots built from it) stays consistent with parentId.
  for (const [id, existing] of agents) {
    if (existing.parentId !== opts.agentId) continue;
    if (
      !edges.some(
        (e) => !e.edgeType && e.source === opts.agentId && e.target === id,
      )
    ) {
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

  if (
    opts.parentId &&
    !edges.some((e) => e.source === opts.parentId && e.target === opts.agentId)
  ) {
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

  // Drain any token deltas that a telemetry export attributed to this id before
  // it registered (OTLP racing ahead of the hook, or the boot seed). Covers
  // every register path — hook, seed, and file discovery — from one place.
  flushPendingTokens(opts.agentId);
}

// Single builder for mid-session agent:register re-broadcasts (model
// change, re-parent, discovery's late-meta heal), deriving the event from
// stored state so a new AgentState field only needs adding here.
export function broadcastRegisterFor(
  agent: AgentState,
  timestamp: number,
): void {
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
    // safe: i is in [0, edges.length) by loop bounds; reverse iteration is safe with splice
    const edge = edges[i]!;
    if (
      !edge.edgeType &&
      edge.source === oldParentId &&
      edge.target === agentId
    ) {
      edges.splice(i, 1);
    }
  }
  if (
    !edges.some(
      (e) => !e.edgeType && e.source === newParentId && e.target === agentId,
    )
  ) {
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
