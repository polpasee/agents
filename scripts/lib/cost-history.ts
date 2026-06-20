// Server-side cost history scanner.
//
// Walks every JSONL file under `~/.claude/projects/**` (the durable record
// of every Claude Code session) and sums per-message cost into rolling
// 24h / 7d / 30d buckets. Used by `/api/costs` to back the Day/Week/Month
// figures in the topology overlay.
//
// Memory discipline: each JSONL is streamed line-by-line so the resident
// set never holds more than one line per file. Parsed (timestamp, cost)
// pairs are cached per-file keyed by mtime so steady-state scans only
// re-parse files that were actually written since the last pass.

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { costFromUsage } from "../../src/lib/costs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Files older than this contribute nothing to the rolling buckets and are
 *  skipped entirely (mtime check) — saves walking ancient sessions. */
const SCAN_HORIZON_MS = 30 * DAY_MS;

/** Result-cache TTL. Day/Week/Month buckets aren't time-critical and the
 *  client polls /api/costs every 60s, so a longer server-side TTL drops
 *  scan frequency from 60/hr to 12/hr without any visible UX change. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cap on simultaneous open read streams. macOS's default ulimit -n is 256
 *  and we share that budget with the SSE viewers and discovery loop — 16
 *  parallelizes enough to hide per-file latency without crowding the table. */
const SCAN_CONCURRENCY = 16;

export interface CostBuckets {
  day: number;
  week: number;
  month: number;
}

interface ResultCacheEntry {
  expires: number;
  result: CostBuckets;
}

interface ParsedEntry {
  timestamp: number;
  total: number;
}

/** Dedupes concurrent cache-miss scans of the same dir onto one promise. */
const inFlight = new Map<string, Promise<CostBuckets>>();

interface FileCacheEntry {
  mtimeMs: number;
  entries: ParsedEntry[];
}

const resultCache = new Map<string, ResultCacheEntry>();

/** Per-file parsed (timestamp, cost) list. Invalidated by mtime change.
 *  Caps total resident set: O(messages within 30d) instead of O(bytes of
 *  JSONL within 30d) — typically a ~20× reduction. */
const fileCache = new Map<string, FileCacheEntry>();

/** Test-only: drop all caches so each test scans fresh. */
export function resetCostHistoryCache(): void {
  resultCache.clear();
  fileCache.clear();
  inFlight.clear();
}

function addToBuckets(buckets: CostBuckets, age: number, total: number): void {
  if (age < 0 || age > SCAN_HORIZON_MS) return;
  buckets.month += total;
  if (age <= 7 * DAY_MS) buckets.week += total;
  if (age <= DAY_MS) buckets.day += total;
}

function costFromLine(line: string): ParsedEntry | null {
  if (!line) return null;
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ts =
    typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
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

/** Stream `file` line-by-line, collecting the cost-bearing entries.
 *  Resident set during the call is bounded to ~one line, regardless of
 *  file size — replaces the prior fs.readFile + split('\n') which held
 *  the entire file in V8 as a string plus a substring array. */
async function parseFileEntries(file: string): Promise<ParsedEntry[]> {
  const out: ParsedEntry[] = [];
  const stream = createReadStream(file, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const e = costFromLine(line);
      if (e) out.push(e);
    }
  } catch {
    // File may have been rotated/truncated mid-stream; partial results
    // are fine — next scan will rebuild on the new mtime.
  }
  return out;
}

/** Run `worker` over `items` with at most `limit` calls in flight at once. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) {
    runners.push(
      (async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/**
 * Scan all JSONL files under `projectsDir`, summing per-message cost into
 * rolling 24h / 7d / 30d windows ending at `now`. Files whose mtime is
 * older than the 30-day horizon are skipped entirely. Results are cached
 * for {@link CACHE_TTL_MS} keyed by `projectsDir`; per-file parsed
 * entries are cached for the lifetime of the process and invalidated by
 * mtime change.
 */
export async function scanCostHistory(
  projectsDir: string,
  now: number = Date.now(),
): Promise<CostBuckets> {
  const cached = resultCache.get(projectsDir);
  if (cached && cached.expires > now) return cached.result;

  const existing = inFlight.get(projectsDir);
  if (existing) return existing;

  const promise = (async (): Promise<CostBuckets> => {
    const buckets: CostBuckets = { day: 0, week: 0, month: 0 };
    const files = await collectJsonlFiles(projectsDir);
    const horizon = now - SCAN_HORIZON_MS;
    const seen = new Set<string>();

    await runWithConcurrency(files, SCAN_CONCURRENCY, async (file) => {
      seen.add(file);
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        return;
      }
      if (stat.mtimeMs < horizon) {
        // Beyond the 30-day window — drop any stale cache so the map can't
        // grow unbounded across long-running dev sessions.
        fileCache.delete(file);
        return;
      }

      let entry = fileCache.get(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs) {
        const entries = await parseFileEntries(file);
        entry = { mtimeMs: stat.mtimeMs, entries };
        fileCache.set(file, entry);
      }
      for (const parsed of entry.entries) {
        addToBuckets(buckets, now - parsed.timestamp, parsed.total);
      }
    });

    // Evict cache entries for files that disappeared (deleted projects,
    // /clear, manual cleanup) so the map mirrors disk over long uptimes.
    for (const key of fileCache.keys()) {
      if (!seen.has(key)) fileCache.delete(key);
    }

    resultCache.set(projectsDir, {
      expires: now + CACHE_TTL_MS,
      result: buckets,
    });
    return buckets;
  })();

  inFlight.set(projectsDir, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(projectsDir);
  }
}
