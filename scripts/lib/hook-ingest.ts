// ── Hook ingestion: Claude Code hook payload → agent store ────────────
// Translates the JSON a Claude Code hook POSTs to /api/ingest/hook into
// push-driven store mutations. Lifecycle/identity/status come from here;
// tokens/cost come from otlp-ingest.ts. Nodes are keyed so a hook and the
// one-shot file seed converge on the SAME id (main = session_id, subagent =
// agent_id minus the `agent-` prefix) — always a merge, never a duplicate.
import { agents } from "./agent-store";
import { registerAgent } from "./agent-registry";
import { parseAgentType } from "./parse-agent-type";
import {
  maybeRegisterExternalAgent,
  maybeCompleteExternalAgent,
} from "./external-agent";
import { recordToolCall } from "./entry-processor";
import {
  touch,
  setPushStatus,
  flushPendingTokensInto,
  pendingSubKey,
} from "./push-ingest";

/** Node id for a hook event: a subagent's own id (file-node form, `agent-`
 *  stripped) when present, else the main session id. */
export function hookNodeId(
  agentId: string | undefined,
  sessionId: string,
): string {
  return agentId ? agentId.replace(/^agent-/, "") : sessionId;
}

/** registerAgent expects the dash-encoded projects-dir name, not a raw cwd. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === "string" ? v : undefined;
}

function projectDirOf(sessionId: string): string {
  const pd = agents.get(sessionId)?.metadata?.projectDir;
  return typeof pd === "string" ? pd : "";
}

function registerMainIfAbsent(
  sessionId: string,
  cwd: string,
  model: string,
  ts: number,
): void {
  if (agents.has(sessionId)) {
    // setPushStatus keeps the clock warm and, being terminal-aware, won't
    // revive a session already ended by SessionEnd (unordered hook delivery).
    setPushStatus(sessionId, "running", ts);
    return;
  }
  registerAgent({
    agentId: sessionId,
    sessionId,
    projectDir: encodeProjectDir(cwd),
    agentType: "main",
    task: "Session",
    slug: "",
    model,
    startTime: ts,
  });
  touch(sessionId, ts);
}

function registerSubIfAbsent(
  agentIdRaw: string,
  sessionId: string,
  agentTypeRaw: string | undefined,
  ts: number,
): string {
  const id = hookNodeId(agentIdRaw, sessionId);
  if (agents.has(id)) {
    setPushStatus(id, "running", ts);
    return id;
  }
  registerAgent({
    agentId: id,
    sessionId,
    projectDir: projectDirOf(sessionId),
    agentType: parseAgentType(agentTypeRaw),
    displayType: agentTypeRaw,
    parentId: sessionId,
    task: agentTypeRaw || "Subagent",
    slug: agentTypeRaw ?? "",
    model: "",
    startTime: ts,
  });
  touch(id, ts);
  // registerAgent already flushed tokens buffered under this node id; also drain
  // any that OTLP buffered under the name key before the subagent existed.
  flushPendingTokensInto(pendingSubKey(sessionId, agentTypeRaw ?? ""), id);
  return id;
}

// Hook delivery is fire-and-forget (detached curl), so a SubagentStart or
// PreToolUse can race ahead of its session's SessionStart. Register the parent
// main first when it's missing, so the subagent never anchors to a nonexistent
// node with an empty projectDir.
function ensureMain(
  p: Record<string, unknown>,
  sessionId: string,
  ts: number,
): void {
  if (!agents.has(sessionId)) {
    registerMainIfAbsent(sessionId, str(p, "cwd") ?? "", "", ts);
  }
}

function onSessionStart(p: Record<string, unknown>, ts: number): void {
  const sessionId = str(p, "session_id");
  if (!sessionId) return;
  registerMainIfAbsent(
    sessionId,
    str(p, "cwd") ?? "",
    str(p, "model") ?? "",
    ts,
  );
}

function onSubagentStart(p: Record<string, unknown>, ts: number): void {
  const sessionId = str(p, "session_id");
  const agentId = str(p, "agent_id");
  if (!sessionId || !agentId) return;
  ensureMain(p, sessionId, ts);
  registerSubIfAbsent(agentId, sessionId, str(p, "agent_type"), ts);
}

function onToolUse(
  p: Record<string, unknown>,
  ts: number,
  isPre: boolean,
): void {
  const sessionId = str(p, "session_id");
  if (!sessionId) return;
  const agentId = str(p, "agent_id");

  // Register-on-first-sight (no reliable SubagentStart hook), then heartbeat.
  let nodeId: string;
  if (agentId) {
    ensureMain(p, sessionId, ts);
    nodeId = registerSubIfAbsent(agentId, sessionId, str(p, "agent_type"), ts);
  } else {
    registerMainIfAbsent(sessionId, str(p, "cwd") ?? "", "", ts);
    nodeId = sessionId;
  }
  setPushStatus(nodeId, "running", ts);
  // If the node is already completed (a tool event reordered after
  // SubagentStop/SessionEnd), setPushStatus left it terminal — don't let
  // recordToolCall revive it or append a spoke.
  if (agents.get(nodeId)?.status === "completed") return;

  const toolName = str(p, "tool_name");
  if (!toolName) return;
  const toolInput =
    p.tool_input && typeof p.tool_input === "object"
      ? (p.tool_input as Record<string, unknown>)
      : undefined;
  const toolUseId = str(p, "tool_use_id");

  if (isPre) {
    // A Codex CLI Bash call becomes its own hollow node instead of a tool
    // spoke (needs a tool_use_id to correlate its PostToolUse completion).
    // Every other tool is recorded as a spoke so push agents keep the tool
    // history the removed file-poll refresh used to populate.
    if (
      toolName === "Bash" &&
      toolUseId &&
      maybeRegisterExternalAgent(
        { name: "Bash", id: toolUseId, input: toolInput ?? {} },
        nodeId,
        ts,
      )
    ) {
      return;
    }
    recordToolCall(nodeId, toolName, toolInput, ts);
  } else if (toolName === "Bash" && toolUseId) {
    // Close the Codex node this Bash call may have opened (no-op otherwise).
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: toolUseId, is_error: false },
      ts,
    );
  }
}

function onUserPrompt(p: Record<string, unknown>, ts: number): void {
  const sessionId = str(p, "session_id");
  if (!sessionId) return;
  registerMainIfAbsent(sessionId, str(p, "cwd") ?? "", "", ts);
}

function onNotification(p: Record<string, unknown>, ts: number): void {
  const sessionId = str(p, "session_id");
  if (!sessionId) return;
  const id = hookNodeId(str(p, "agent_id"), sessionId);
  if (!agents.has(id)) return;
  // The notification type may arrive under any of these keys depending on the
  // Claude Code build. Only map "needs input" → waiting; deliberately NOT
  // agent_completed → completed: with no agent_id it resolves to the session
  // id and would mark a live MAIN completed, violating the "only SessionEnd
  // completes a main" invariant. Real completion comes from SubagentStop /
  // SessionEnd.
  const kind =
    str(p, "notification_type") ?? str(p, "type") ?? str(p, "matcher");
  if (kind === "agent_needs_input") setPushStatus(id, "waiting", ts);
}

function onSubagentStop(p: Record<string, unknown>, ts: number): void {
  const agentId = str(p, "agent_id");
  if (!agentId) return;
  const id = hookNodeId(agentId, str(p, "session_id") ?? "");
  const node = agents.get(id);
  if (!node) return;
  setPushStatus(id, "completed", ts, {
    duration: Math.max(0, ts - node.startTime),
    summary: str(p, "last_assistant_message"),
  });
}

function onStop(p: Record<string, unknown>, ts: number): void {
  // The Stop hook fires at the end of every assistant turn, not at session
  // end — so a main goes idle (a later prompt/tool event returns it to
  // running); only SessionEnd marks a main completed.
  const sessionId = str(p, "session_id");
  if (!sessionId || !agents.has(sessionId)) return;
  setPushStatus(sessionId, "idle", ts);
}

function onSessionEnd(p: Record<string, unknown>, ts: number): void {
  const sessionId = str(p, "session_id");
  if (!sessionId) return;
  const node = agents.get(sessionId);
  if (!node) return;
  setPushStatus(sessionId, "completed", ts, {
    duration: Math.max(0, ts - node.startTime),
  });
}

/** Route a hook payload to its handler. Unknown events are ignored (a hook
 *  must never surface an error in Claude Code). `ts` is injectable for tests. */
export function dispatchHookEvent(
  p: Record<string, unknown>,
  ts: number = Date.now(),
): void {
  switch (str(p, "hook_event_name")) {
    case "SessionStart":
      return onSessionStart(p, ts);
    case "SubagentStart":
      return onSubagentStart(p, ts);
    case "PreToolUse":
      return onToolUse(p, ts, true);
    case "PostToolUse":
      return onToolUse(p, ts, false);
    case "UserPromptSubmit":
      return onUserPrompt(p, ts);
    case "Notification":
      return onNotification(p, ts);
    case "SubagentStop":
      return onSubagentStop(p, ts);
    case "Stop":
      return onStop(p, ts);
    case "SessionEnd":
      return onSessionEnd(p, ts);
    default:
      return;
  }
}
