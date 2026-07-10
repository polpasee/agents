// ── OTLP ingestion: OpenTelemetry logs → per-agent token totals ───────
// Receives the OTLP/HTTP JSON that Claude Code / Codex export to
// /api/otlp/v1/logs and folds `claude_code.api_request` token counts onto the
// matching store node. Lifecycle/identity come from hook-ingest.ts; this only
// supplies tokens/cost. JSON only — no protobuf dependency.
import { agents, agentLastModified } from "./agent-store";
import { addTokens, pendingSubKey } from "./push-ingest";

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface OtlpKeyValue {
  key?: string;
  value?: OtlpAnyValue;
}

type Attrs = Record<string, string | number | boolean>;

/** Flatten an OTLP attribute list into a plain map, unwrapping the AnyValue
 *  type tag. Unknown/empty value types are skipped. */
export function flattenAttrs(attrs: unknown): Attrs {
  const out: Attrs = {};
  if (!Array.isArray(attrs)) return out;
  for (const kv of attrs as OtlpKeyValue[]) {
    if (!kv || typeof kv.key !== "string" || !kv.value) continue;
    const v = kv.value;
    if (typeof v.stringValue === "string") out[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) {
      // OTLP/JSON encodes int64 as a string; a malformed/overflowing value must
      // not become NaN/Infinity (typeof both === "number") and poison a token
      // total — drop the attribute instead.
      const n = Number(v.intValue);
      if (Number.isFinite(n)) out[kv.key] = n;
    } else if (
      typeof v.doubleValue === "number" &&
      Number.isFinite(v.doubleValue)
    )
      out[kv.key] = v.doubleValue;
    else if (typeof v.boolValue === "boolean") out[kv.key] = v.boolValue;
  }
  return out;
}

/** Which store node owns these token counts. Main (or absent query_source) →
 *  the session node (id == session.id, exact). Subagent → the most recently
 *  active node in that session whose type/name matches `agent.name` (N
 *  same-named concurrent subagents can't be disambiguated — OTLP carries no
 *  subagent id). When no subagent node exists yet — a subagent's first LLM
 *  request typically precedes its first tool/PreToolUse — return a name-scoped
 *  pending-buffer key so the tokens are held for the real node instead of being
 *  misattributed to the main; `registerSubIfAbsent` drains it on registration.
 *  Only when `agent.name` is missing do we fall back to the session main. */
export function resolveTokenNodeId(attrs: Attrs): string | undefined {
  const sessionId =
    typeof attrs["session.id"] === "string"
      ? (attrs["session.id"] as string)
      : undefined;
  if (!sessionId) return undefined;

  if (attrs["query_source"] !== "subagent") return sessionId;

  const agentName =
    typeof attrs["agent.name"] === "string"
      ? (attrs["agent.name"] as string)
      : undefined;
  let best: string | undefined;
  let bestTs = -1;
  for (const [id, a] of agents) {
    if (a.sessionId !== sessionId || a.agentType === "main") continue;
    if (
      agentName &&
      a.displayType !== agentName &&
      a.agentType !== agentName &&
      a.slug !== agentName
    ) {
      continue;
    }
    const ts = agentLastModified.get(id) ?? a.startTime;
    if (ts > bestTs) {
      bestTs = ts;
      best = id;
    }
  }
  if (best) return best;
  return agentName ? pendingSubKey(sessionId, agentName) : sessionId;
}

// Drop duplicate api_request records (OTLP retransmits on retry) by request id.
// Bounded; cleared wholesale when full — over-counting one record after a rare
// 5000-request wrap is harmless on a single-machine localhost feed.
const SEEN_REQUESTS_MAX = 5000;
const seenRequests = new Set<string>();

function num(attrs: Attrs, key: string): number {
  const v = attrs[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function handleLogRecord(attrs: Attrs): void {
  const isApiRequest = attrs["event.name"] === "claude_code.api_request";
  const hasTokens =
    attrs["input_tokens"] !== undefined || attrs["output_tokens"] !== undefined;
  if (!isApiRequest && !hasTokens) return;

  const reqId = attrs["request_id"];
  if (typeof reqId === "string") {
    if (seenRequests.has(reqId)) return;
    if (seenRequests.size >= SEEN_REQUESTS_MAX) seenRequests.clear();
    seenRequests.add(reqId);
  }

  const id = resolveTokenNodeId(attrs);
  if (!id) return;
  addTokens(id, {
    input: num(attrs, "input_tokens"),
    output: num(attrs, "output_tokens"),
    cacheRead: num(attrs, "cache_read_tokens"),
    cacheCreate: num(attrs, "cache_creation_tokens"),
  });
}

/** Walk an OTLP/HTTP logs export, applying token records. Tolerant of missing
 *  levels — a malformed batch simply yields no updates. */
export function ingestOtlpLogs(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const resourceLogs = (body as { resourceLogs?: unknown }).resourceLogs;
  if (!Array.isArray(resourceLogs)) return;
  for (const rl of resourceLogs) {
    const resourceAttrs = flattenAttrs(
      (rl as { resource?: { attributes?: unknown } })?.resource?.attributes,
    );
    const scopeLogs = (rl as { scopeLogs?: unknown })?.scopeLogs;
    if (!Array.isArray(scopeLogs)) continue;
    for (const sl of scopeLogs) {
      const records = (sl as { logRecords?: unknown })?.logRecords;
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        const attrs = {
          ...resourceAttrs,
          ...flattenAttrs((rec as { attributes?: unknown })?.attributes),
        };
        handleLogRecord(attrs);
      }
    }
  }
}

/** Test-only: clear the request-dedupe set between cases. */
export function resetSeenRequestsForTest(): void {
  seenRequests.clear();
}
