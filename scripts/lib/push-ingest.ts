// ── Push ingestion primitives (hooks + OTLP) ──────────────────────────
// Shared by the hook route and the OTLP route: claiming/heartbeating a
// fileless node, mutating its status, and accumulating token counts.
// Mirrors external-agent.ts's fileless "hollow node" pattern — direct
// mutation + a hand-built broadcast — rather than routing through
// updateAgentStatus (which infers running/idle from file mtime and would
// fight the hook-driven state machine).
import type { AgentEvent, AgentStatus } from "../../src/lib/types";
import { agents, agentLastModified, agentFilePaths } from "./agent-store";
import { broadcast } from "./sse-broadcast";

/** Claim (or heartbeat) a push-driven node: bump its activity clock and
 *  detach it from the file world, so the retained file-poller's residual
 *  passes (pruning, dedup) treat it as push-owned from the first hook/OTLP
 *  event onward. Called first by every push handler. */
export function touch(id: string, ts: number): void {
  const prev = agentLastModified.get(id) ?? 0;
  agentLastModified.set(id, Math.max(prev, ts));
  agentFilePaths.delete(id);
}

export interface SetPushStatusOpts {
  duration?: number | undefined;
  summary?: string | undefined;
  waitingOn?: string | undefined;
}

/** Mutate an already-registered node's status and broadcast the matching
 *  event. Transitioning to `completed` always broadcasts `agent:complete`
 *  (SubagentStop / SessionEnd are the only push transitions into
 *  `completed`); every other status broadcasts `agent:status` — matching
 *  the external-agent.ts rule that a mere status change never fires the
 *  completion chime. No-ops if the node isn't registered (a status event
 *  arriving before its register-on-first-sight event — should not happen,
 *  but a push handler must never throw on a stray hook). */
export function setPushStatus(
  id: string,
  status: AgentStatus,
  ts: number,
  opts: SetPushStatusOpts = {},
): void {
  touch(id, ts);
  const agent = agents.get(id);
  if (!agent) return;

  agent.status = status;
  if (opts.duration !== undefined) agent.duration = opts.duration;
  if (opts.summary !== undefined) agent.summary = opts.summary;
  if (opts.waitingOn !== undefined) agent.waitingOn = opts.waitingOn;

  const event: AgentEvent =
    status === "completed"
      ? {
          type: "agent:complete",
          agentId: id,
          summary: opts.summary,
          duration: opts.duration ?? 0,
        }
      : {
          type: "agent:status",
          agentId: id,
          status,
          waitingOn: opts.waitingOn,
        };
  broadcast({ type: "state:update", event, timestamp: ts });
}

export interface TokenDeltas {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheCreate?: number | undefined;
}

interface PendingTokenBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  contextWindow?: number | undefined;
}

// Rare-race buffer: tokens attributed to a node the hook route hasn't
// registered yet (an OTLP export racing ahead of the corresponding
// SessionStart/SubagentStart hook). Capped so a stream of tokens for
// unknown/garbage ids can't grow this unboundedly.
const PENDING_TOKENS_MAX_ENTRIES = 200;
const pendingTokens = new Map<string, PendingTokenBucket>();

function accumulate(bucket: PendingTokenBucket, deltas: TokenDeltas): void {
  bucket.input += deltas.input ?? 0;
  bucket.output += deltas.output ?? 0;
  bucket.cacheRead += deltas.cacheRead ?? 0;
  bucket.cacheCreate += deltas.cacheCreate ?? 0;
}

/** Add token deltas to a node's running totals and broadcast the new
 *  totals (client `applyTokens` sets absolute values, not deltas). If the
 *  node isn't registered yet, buffer the deltas instead — flushed via
 *  `flushPendingTokens` once the node registers. */
export function addTokens(
  id: string,
  deltas: TokenDeltas,
  contextWindow?: number,
): void {
  const agent = agents.get(id);
  if (!agent) {
    let bucket = pendingTokens.get(id);
    if (!bucket) {
      if (pendingTokens.size >= PENDING_TOKENS_MAX_ENTRIES) {
        const oldestKey = pendingTokens.keys().next().value;
        if (oldestKey !== undefined) pendingTokens.delete(oldestKey);
      }
      bucket = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      pendingTokens.set(id, bucket);
    }
    accumulate(bucket, deltas);
    if (contextWindow !== undefined) bucket.contextWindow = contextWindow;
    return;
  }

  const ts = Date.now();
  agent.inputTokens = (agent.inputTokens || 0) + (deltas.input ?? 0);
  agent.outputTokens = (agent.outputTokens || 0) + (deltas.output ?? 0);
  agent.cacheReadTokens =
    (agent.cacheReadTokens || 0) + (deltas.cacheRead ?? 0);
  agent.cacheCreateTokens =
    (agent.cacheCreateTokens || 0) + (deltas.cacheCreate ?? 0);
  if (contextWindow !== undefined) agent.contextWindow = contextWindow;
  touch(id, ts);

  const event: AgentEvent = {
    type: "agent:tokens",
    agentId: id,
    inputTokens: agent.inputTokens,
    outputTokens: agent.outputTokens,
    cacheReadTokens: agent.cacheReadTokens,
    cacheCreateTokens: agent.cacheCreateTokens,
    contextWindow: agent.contextWindow,
  };
  broadcast({ type: "state:update", event, timestamp: ts });
}

/** Test-only: clear the pending-token buffer. It is plain module state (not
 *  on the HMR-safe globalThis singleton, since losing a rare in-flight
 *  buffer across a dev reload is harmless) but that means it otherwise
 *  leaks between test cases in the same file. */
export function resetPendingTokensForTest(): void {
  pendingTokens.clear();
}

/** Replay any buffered token deltas for a node that just registered. Call
 *  immediately after `registerAgent` in both the hook and OTLP routes. */
export function flushPendingTokens(id: string): void {
  const bucket = pendingTokens.get(id);
  if (!bucket) return;
  pendingTokens.delete(id);
  addTokens(
    id,
    {
      input: bucket.input,
      output: bucket.output,
      cacheRead: bucket.cacheRead,
      cacheCreate: bucket.cacheCreate,
    },
    bucket.contextWindow,
  );
}
