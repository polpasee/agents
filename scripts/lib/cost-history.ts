// Server-side cost history scanner.
//
// Walks every JSONL file under `~/.claude/projects/**` (the durable record
// of every Claude Code session) and sums per-message cost into rolling
// 24h / 7d / 30d buckets. Used by `/api/costs` to back the Day/Week/Month
// figures in the topology overlay.
//
// Why scan instead of persist separately? Claude Code already writes every
// session to disk with full token usage + model + timestamp. A parallel
// persistence layer would just duplicate that data and risk drift. The
// trade-off is per-request file I/O — bounded by the 60s in-memory cache
// and an mtime-based file-skip so cold sessions cost nothing.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { costFromUsage } from "../../src/lib/costs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Files older than this contribute nothing to the rolling buckets and are
 *  skipped entirely (mtime check) — saves walking ancient sessions. */
const SCAN_HORIZON_MS = 30 * DAY_MS;

/** Cache TTL — `/api/costs` is hit by every viewer every ~60s, so even one
 *  cache prevents pathological re-scans during normal browsing. */
const CACHE_TTL_MS = 60_000;

export interface CostBuckets {
  day: number;
  week: number;
  month: number;
}

interface CacheEntry {
  expires: number;
  result: CostBuckets;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CostBuckets>>();

/** Test-only: drop the in-memory cache so each test scans fresh. */
export function resetCostHistoryCache(): void {
  cache.clear();
}

/** Bucketing helper — places a single message's cost into the right windows. */
function addToBuckets(buckets: CostBuckets, age: number, total: number): void {
  if (age < 0 || age > SCAN_HORIZON_MS) return;
  buckets.month += total;
  if (age <= 7 * DAY_MS) buckets.week += total;
  if (age <= DAY_MS) buckets.day += total;
}

/** Parse one JSONL line, returning the cost contribution or null if the line
 *  doesn't have the assistant-usage shape we care about. */
function costFromLine(line: string): { timestamp: number; total: number } | null {
  if (!line) return null;
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return null;
  const usage = message.usage as Record<string, number> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const model = typeof message.model === "string" ? message.model : undefined;
  const { total } = costFromUsage(
    {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
    },
    model,
  );
  return { timestamp: ts, total };
}

/** Recursively collect every `*.jsonl` file under `dir`. Tolerates missing
 *  directories (returns []) so a fresh install with no projects yet works. */
async function collectJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonlFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan all JSONL files under `projectsDir`, summing per-message cost into
 * rolling 24h / 7d / 30d windows ending at `now`. Files whose mtime is
 * older than the 30-day horizon are skipped entirely. Results are cached
 * for {@link CACHE_TTL_MS} keyed by `projectsDir`.
 */
export async function scanCostHistory(
  projectsDir: string,
  now: number = Date.now(),
): Promise<CostBuckets> {
  const cached = cache.get(projectsDir);
  if (cached && cached.expires > now) return cached.result;

  const existing = inFlight.get(projectsDir);
  if (existing) return existing;

  const promise = (async (): Promise<CostBuckets> => {
    const buckets: CostBuckets = { day: 0, week: 0, month: 0 };
    const files = await collectJsonlFiles(projectsDir);
    const horizon = now - SCAN_HORIZON_MS;

    await Promise.all(files.map(async (file) => {
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        return;
      }
      if (stat.mtimeMs < horizon) return; // file untouched in 30d → no relevant entries
      let raw;
      try {
        raw = await fs.readFile(file, "utf-8");
      } catch {
        return;
      }
      for (const line of raw.split("\n")) {
        const entry = costFromLine(line);
        if (!entry) continue;
        addToBuckets(buckets, now - entry.timestamp, entry.total);
      }
    }));

    cache.set(projectsDir, { expires: now + CACHE_TTL_MS, result: buckets });
    return buckets;
  })();

  inFlight.set(projectsDir, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(projectsDir);
  }
}
