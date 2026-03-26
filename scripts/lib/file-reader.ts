import * as fs from "fs";
import { JSONL_MAX_BYTES, MAX_TASK_LENGTH } from "./config";

const fileOffsets = new Map<string, number>();

/** Strip XML/HTML tags and clean up internal command markup from task text */
function cleanTaskText(raw: string): string {
  let text = raw.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

const READ_MAX_BYTES = 512 * 1024; // 512KB max per poll cycle

export function readNewLines(filePath: string): string[] {
  const offset = fileOffsets.get(filePath) || 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    console.warn(`Failed to stat ${filePath}:`, err);
    return [];
  }
  if (stat.size <= offset) return [];

  const bytesToRead = Math.min(stat.size - offset, READ_MAX_BYTES);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(bytesToRead);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, offset + bytesToRead);

  return buf
    .toString("utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

export function extractTaskFromJSONL(
  filePath: string,
  maxBytes = JSONL_MAX_BYTES
): { task: string; slug: string; model: string; startTime?: number } {
  const result = { task: "", slug: "", model: "", startTime: undefined as number | undefined };
  try {
    const stat = fs.statSync(filePath);
    const chunk = Buffer.alloc(Math.min(stat.size, maxBytes));
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, chunk, 0, chunk.length, 0);
    fs.closeSync(fd);
    const lines = chunk.toString("utf-8").split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.timestamp && !result.startTime) {
          result.startTime = new Date(parsed.timestamp).getTime();
        }
        if (parsed.slug) result.slug = parsed.slug;
        if (parsed.message?.model) result.model = parsed.message.model;
        if (parsed.message?.role === "user" && !result.task) {
          const content = parsed.message.content;
          if (typeof content === "string") {
            result.task = cleanTaskText(content).slice(0, MAX_TASK_LENGTH);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
            if (textBlock && typeof textBlock.text === "string") {
              result.task = cleanTaskText(textBlock.text).slice(0, MAX_TASK_LENGTH);
            }
          }
        }
        if (result.task && result.model) break;
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    console.warn(`Failed to extract task from ${filePath}:`, err);
  }
  return result;
}

/** Remove tracked offsets for files that no longer exist (prevents memory leak) */
export function cleanupFileOffsets() {
  for (const filePath of fileOffsets.keys()) {
    if (!fs.existsSync(filePath)) {
      fileOffsets.delete(filePath);
    }
  }
}
