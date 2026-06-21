import * as fs from "node:fs";
import * as path from "node:path";
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
  const normalized = path.resolve(filePath);
  const offset = fileOffsets.get(normalized) || 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to stat ${normalized}:`, err);
    }
    return [];
  }
  if (stat.size <= offset) return [];

  const bytesToRead = Math.min(stat.size - offset, READ_MAX_BYTES);
  let fd: number;
  try {
    fd = fs.openSync(normalized, "r");
  } catch (err) {
    // File vanished between stat and open — degrade to "no new lines"
    // instead of throwing out of the caller's discovery loop.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to open ${normalized}:`, err);
    }
    return [];
  }
  let buf: Buffer;
  let bytesRead: number;
  try {
    buf = Buffer.alloc(bytesToRead);
    // A short read can return fewer bytes than requested, leaving stale/zero
    // bytes in the buffer tail; clamp all downstream math to bytesRead.
    bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const readBytes = Math.min(bytesToRead, bytesRead);

  // Find the last complete line boundary to avoid splitting a partial JSON line
  let usableBytes = readBytes;
  if (readBytes < stat.size - offset) {
    // We didn't read the whole remaining file — find last newline
    // within the actually-read region (ignore any stale buffer tail).
    const lastNewline = buf.subarray(0, readBytes).lastIndexOf(10); // 10 = '\n'
    if (lastNewline >= 0) {
      usableBytes = lastNewline + 1;
    }
    // If no newline found, read it all and let JSON.parse handle the error
  }
  fileOffsets.set(normalized, offset + usableBytes);

  return buf
    .subarray(0, usableBytes)
    .toString("utf-8")
    .split("\n")
    .filter((l: string) => l.trim().length > 0);
}

export function extractTaskFromJSONL(
  filePath: string,
  maxBytes = JSONL_MAX_BYTES,
): {
  task: string;
  slug: string;
  model: string;
  startTime?: number | undefined;
} {
  const result = {
    task: "",
    slug: "",
    model: "",
    startTime: undefined as number | undefined,
  };
  try {
    const stat = fs.statSync(filePath);
    const chunk = Buffer.alloc(Math.min(stat.size, maxBytes));
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, 0);
    fs.closeSync(fd);
    // A short read leaves stale/zero bytes in the chunk tail — decode only
    // the bytes actually read.
    const lines = chunk
      .subarray(0, bytesRead)
      .toString("utf-8")
      .split("\n")
      .filter((l: string) => l.trim());
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
            const textBlock = content.find(
              (b: Record<string, unknown>) => b.type === "text",
            );
            if (textBlock && typeof textBlock.text === "string") {
              result.task = cleanTaskText(textBlock.text).slice(
                0,
                MAX_TASK_LENGTH,
              );
            }
          }
        }
        if (result.task && result.model) break;
      } catch {
        /* skip malformed lines */
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to extract task from ${filePath}:`, err);
    }
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
