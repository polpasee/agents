import * as fsp from "node:fs/promises";
import type { LogEntry, LogToolCall } from "../../src/lib/types";
import { LOG_READ_MAX_BYTES } from "./config";

const MAX_ENTRIES = 500;

/** Read an agent's JSONL file and return structured log entries.
 *  Refuses to load files larger than LOG_READ_MAX_BYTES (default 10MB)
 *  so a multi-GB session file can't OOM the server — we return just the tail. */
export async function readAgentLog(filePath: string): Promise<LogEntry[]> {
  const stat = await fsp.stat(filePath);
  let content: string;
  if (stat.size > LOG_READ_MAX_BYTES) {
    // Read only the last LOG_READ_MAX_BYTES bytes; the first (partial) line
    // after the seek point will be dropped by the JSON.parse try/catch below.
    const fh = await fsp.open(filePath, "r");
    try {
      const buf = Buffer.alloc(LOG_READ_MAX_BYTES);
      await fh.read(buf, 0, LOG_READ_MAX_BYTES, stat.size - LOG_READ_MAX_BYTES);
      content = buf.toString("utf-8");
    } finally {
      await fh.close();
    }
  } else {
    content = await fsp.readFile(filePath, "utf-8");
  }
  const lines = content.split("\n").filter(Boolean);
  const entries: LogEntry[] = [];
  const pendingToolCalls = new Map<string, LogToolCall>();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.type || !obj.message) continue;

      const role = obj.message.role;
      const timestamp = obj.timestamp
        ? new Date(obj.timestamp).getTime()
        : Date.now();

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
                pending.result =
                  typeof block.content === "string"
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
                input:
                  typeof block.input === "string"
                    ? block.input.slice(0, 2000)
                    : JSON.stringify(block.input ?? {}).slice(0, 2000),
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
}

function isTextBlock(b: unknown): b is { type: "text"; text: string } {
  return (
    b != null &&
    typeof b === "object" &&
    (b as Record<string, unknown>).type === "text" &&
    typeof (b as Record<string, unknown>).text === "string"
  );
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}
