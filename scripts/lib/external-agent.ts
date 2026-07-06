import { registerAgent } from "./agent-registry";
import { agents, agentLastModified } from "./agent-store";
import { broadcast } from "./sse-broadcast";
import { EXTERNAL_AGENT_ID_PREFIX } from "./config";
import type { AgentEvent } from "../../src/lib/types";

const MAX_TASK_PREVIEW = 80;

// Detect a Codex CLI invocation in a Bash command. To avoid matching the word
// "codex" when it merely appears as an ARGUMENT or inside a quoted string
// (common in this repo), `codex` must sit at a COMMAND position: the start of
// the command (after any leading whitespace), or right after a shell separator
// (; & | ( backtick), optionally via a path prefix (./codex, /usr/bin/codex).
// The trailing edge allows whitespace, end-of-string, or a shell operator, so
// `codex;`, `codex&`, `codex>log`, and `(codex)` are still detected.
// Trade-offs (precision over recall — a false positive spawns a phantom node):
// runner-prefixed forms (`sudo codex`, `npx codex`, `env X=Y codex`) and a
// `codex` that begins a *continuation* line of a multi-line command / heredoc
// are NOT matched (newline is deliberately excluded from the separators so a
// heredoc body mentioning codex can't spawn a node).
//
// One exception: `rtk proxy <cmd>` (a CLI wrapper some contributors use as a
// passthrough) is, by its own contract, a raw-passthrough escape hatch that
// runs `<cmd>` literally, unfiltered — so the token right after `rtk proxy`
// carries the same "this is the real target command" guarantee a
// bare command position does. Allowed as an optional prefix immediately before
// `codex`. Deliberately NOT generalized to other runners (`sudo`, `npx`,
// `env VAR=val`, ...): those don't carry that guarantee, so admitting them
// would reopen the precision/recall trade-off this detector intentionally
// closed.
const CODEX_CMD_RE =
  /(?:^|[;&|(`])\s*(?:rtk\s+proxy\s+)?(?:\S*\/)?codex(?:\s|$|[;&|)<>])/;

export function isCodexCommand(command: string): boolean {
  return CODEX_CMD_RE.test(command);
}

function codexNodeId(toolUseId: string): string {
  return EXTERNAL_AGENT_ID_PREFIX + toolUseId;
}

// Called for each assistant tool_use block. When it is a Bash call invoking the
// Codex CLI, synthesize a "hollow" sub-agent node hanging off the calling agent
// and return true so the caller skips the normal tool-spoke recording (the call
// is represented as the node instead). Returns false for anything else.
export function maybeRegisterExternalAgent(
  block: Record<string, unknown>,
  ownerAgentId: string,
  timestamp: number,
): boolean {
  if (block.name !== "Bash") return false;
  if (typeof block.id !== "string") return false;
  const input =
    block.input && typeof block.input === "object"
      ? (block.input as Record<string, unknown>)
      : undefined;
  const command =
    typeof input?.command === "string" ? input.command : undefined;
  if (!command || !isCodexCommand(command)) return false;

  const codexId = codexNodeId(block.id);
  if (agents.has(codexId)) return true; // already tracked — still suppress the spoke

  const owner = agents.get(ownerAgentId);
  const sessionId = owner?.sessionId ?? ownerAgentId;
  const projectDir =
    typeof owner?.metadata?.projectDir === "string"
      ? (owner.metadata.projectDir as string)
      : "";
  const description =
    typeof input?.description === "string" ? input.description : undefined;
  const task = (description || command).slice(0, MAX_TASK_PREVIEW);

  registerAgent({
    agentId: codexId,
    sessionId,
    projectDir,
    agentType: "generic",
    displayType: "Codex",
    parentId: ownerAgentId,
    task,
    slug: "codex",
    model: "codex",
    startTime: timestamp,
  });
  return true;
}

// Called for each user-role tool_result block. When it closes a Codex node we
// synthesized, flip it to a terminal state (error if the tool_result reports a
// failure, otherwise idle — mirroring how a real sub-agent finishes) and record
// its run time. Broadcasts agent:status, NOT agent:complete: a hollow external
// call must not fire the completion chime/animation that real sub-agents (which
// go running→idle→removed) never trigger.
export function maybeCompleteExternalAgent(
  block: Record<string, unknown>,
  timestamp: number,
): void {
  if (block.type !== "tool_result") return;
  const toolUseId = block.tool_use_id;
  if (typeof toolUseId !== "string") return;
  const codexId = codexNodeId(toolUseId);
  const node = agents.get(codexId);
  if (!node || node.status !== "running") return; // idempotent — only a live node

  node.status = block.is_error === true ? "error" : "idle";
  if (Number.isFinite(timestamp)) {
    node.duration = Math.max(0, timestamp - node.startTime);
    // Age the terminal node out from completion time (not spawn time) so it
    // lingers one stale window after the call ends instead of vanishing at once.
    agentLastModified.set(codexId, timestamp);
  }

  const event: AgentEvent = {
    type: "agent:status",
    agentId: codexId,
    status: node.status,
  };
  broadcast({ type: "state:update", event, timestamp });
}
