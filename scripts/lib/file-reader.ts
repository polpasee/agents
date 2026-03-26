import * as fs from "fs";

const fileOffsets = new Map<string, number>();

/** Strip XML/HTML tags and clean up internal command markup from task text */
function cleanTaskText(raw: string): string {
  // Strip all XML/HTML tags
  let text = raw.replace(/<[^>]+>/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export function readNewLines(filePath: string): string[] {
  const offset = fileOffsets.get(filePath) || 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (stat.size <= offset) return [];

  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  return buf
    .toString("utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

export function extractTaskFromJSONL(
  filePath: string,
  maxBytes = 16384
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
            result.task = cleanTaskText(content).slice(0, 100);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
            if (textBlock) result.task = cleanTaskText(textBlock.text as string).slice(0, 100);
          }
        }
        if (result.task && result.model) break;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* ignore */ }
  return result;
}
