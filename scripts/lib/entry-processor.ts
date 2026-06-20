import type { AgentEvent, ToolCallEntry } from "../../src/lib/types";
import {
  MAX_TOOL_CALLS_PER_AGENT,
  INLINE_ARGS_MAX_KEYS,
  MAX_ARG_PREVIEW_LENGTH,
} from "./config";
import { broadcast } from "./sse-broadcast";
import { agents } from "./agent-store";
import { recordSpawnToolUse } from "./spawn-index";
import { broadcastRegisterFor } from "./agent-registry";

// ── Process a JSONL entry ──────────────────────────────
export function processEntry(entry: Record<string, unknown>, agentId: string) {
  // Defensive wrapper: the polling tick reads many JSONL entries and one bad
  // entry must not crash the whole loop. Malformed inputs (circular refs in
  // tool input, unexpected shapes) get logged and skipped.
  try {
    return processEntryInner(entry, agentId);
  } catch (err) {
    console.warn(
      `processEntry: failed to process entry for agent ${agentId}:`,
      err,
    );
    return;
  }
}

function processEntryInner(entry: Record<string, unknown>, agentId: string) {
  const timestamp =
    typeof entry.timestamp === "string"
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
        const input =
          b.input && typeof b.input === "object"
            ? (b.input as Record<string, unknown>)
            : undefined;
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
          const tc: ToolCallEntry = {
            tool: toolName,
            args: argsStr,
            timestamp,
          };
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
        agent.cacheReadTokens =
          (agent.cacheReadTokens || 0) + (u.cache_read_input_tokens || 0);
        agent.cacheCreateTokens =
          (agent.cacheCreateTokens || 0) + (u.cache_creation_input_tokens || 0);

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
