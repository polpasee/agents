import * as fs from "fs";
import type { LogEntry, LogToolCall } from "../../src/lib/types";

const MAX_ENTRIES = 500;

/** Read an agent's JSONL file and return structured log entries */
export function readAgentLog(filePath: string): LogEntry[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const entries: LogEntry[] = [];
    const pendingToolCalls = new Map<string, LogToolCall>();

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!obj.type || !obj.message) continue;

        const role = obj.message.role;
        const timestamp = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();

        if (role === "user") {
          // User message - extract text content
          const content = extractTextContent(obj.message.content);
          if (content) {
            entries.push({ timestamp, role: "user", content });
          }
          // Also check for tool_result blocks
          if (Array.isArray(obj.message.content)) {
            for (const block of obj.message.content) {
              if (block.type === "tool_result" && block.tool_use_id) {
                const pending = pendingToolCalls.get(block.tool_use_id);
                if (pending) {
                  pending.result = typeof block.content === "string"
                    ? block.content.slice(0, 2000)
                    : JSON.stringify(block.content).slice(0, 2000);
                  pendingToolCalls.delete(block.tool_use_id);
                }
              }
            }
          }
        } else if (role === "assistant") {
          const content = extractTextContent(obj.message.content);
          const toolCalls: LogToolCall[] = [];

          if (Array.isArray(obj.message.content)) {
            for (const block of obj.message.content) {
              if (block.type === "tool_use") {
                const tc: LogToolCall = {
                  id: block.id || "",
                  name: block.name || "unknown",
                  input: typeof block.input === "string" ? block.input.slice(0, 2000) : JSON.stringify(block.input ?? {}).slice(0, 2000),
                };
                toolCalls.push(tc);
                pendingToolCalls.set(tc.id, tc);
              }
            }
          }

          if (content || toolCalls.length > 0) {
            entries.push({
              timestamp,
              role: "assistant",
              content: content || "",
              ...(toolCalls.length > 0 ? { toolCalls } : {}),
            });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
    return entries.slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function isTextBlock(b: unknown): b is { type: "text"; text: string } {
  return b != null && typeof b === "object"
    && (b as Record<string, unknown>).type === "text"
    && typeof (b as Record<string, unknown>).text === "string";
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(isTextBlock).map((b) => b.text).join("\n");
  }
  return "";
}
