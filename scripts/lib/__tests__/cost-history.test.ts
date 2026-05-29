import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { scanCostHistory, resetCostHistoryCache } from "../cost-history";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let tmpDir: string;
const NOW = 1_700_000_000_000;

function jsonlLine(timestamp: number, model: string, usage: Record<string, number>): string {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(),
    message: { role: "assistant", model, usage },
  });
}

beforeEach(async () => {
  resetCostHistoryCache();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cost-history-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("scanCostHistory", () => {
  it("returns zero buckets when the projects dir is missing", async () => {
    const r = await scanCostHistory(path.join(tmpDir, "does-not-exist"), NOW);
    expect(r).toEqual({ day: 0, week: 0, month: 0 });
  });

  it("returns zero buckets when the projects dir is empty", async () => {
    const r = await scanCostHistory(tmpDir, NOW);
    expect(r).toEqual({ day: 0, week: 0, month: 0 });
  });

  it("counts a recent assistant message in all three buckets", async () => {
    const projDir = path.join(tmpDir, "-project-a");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    await fs.writeFile(file, jsonlLine(NOW - HOUR, "claude-sonnet-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    // mtime must be within the 30-day horizon for the file to be scanned.
    await fs.utimes(file, NOW / 1000, NOW / 1000);
    const r = await scanCostHistory(tmpDir, NOW);
    // sonnet input rate = $3/M tokens
    expect(r.day).toBeCloseTo(3);
    expect(r.week).toBeCloseTo(3);
    expect(r.month).toBeCloseTo(3);
  });

  it("places a 10-day-old message in month only", async () => {
    const projDir = path.join(tmpDir, "-project-a");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    const ts = NOW - 10 * DAY;
    await fs.writeFile(file, jsonlLine(ts, "claude-sonnet-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    await fs.utimes(file, ts / 1000, ts / 1000);
    const r = await scanCostHistory(tmpDir, NOW);
    expect(r.day).toBe(0);
    expect(r.week).toBe(0);
    expect(r.month).toBeCloseTo(3);
  });

  it("skips files whose mtime is older than the 30-day horizon", async () => {
    const projDir = path.join(tmpDir, "-project-a");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    const ts = NOW - 60 * DAY;
    await fs.writeFile(file, jsonlLine(ts, "claude-sonnet-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    await fs.utimes(file, ts / 1000, ts / 1000);
    const r = await scanCostHistory(tmpDir, NOW);
    expect(r).toEqual({ day: 0, week: 0, month: 0 });
  });

  it("walks nested subagent JSONL files", async () => {
    const projDir = path.join(tmpDir, "-project-a", "session-1", "subagents");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "sub.jsonl");
    await fs.writeFile(file, jsonlLine(NOW - HOUR, "claude-haiku-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    await fs.utimes(file, NOW / 1000, NOW / 1000);
    const r = await scanCostHistory(tmpDir, NOW);
    // haiku input rate = $0.8/M tokens
    expect(r.day).toBeCloseTo(0.8);
  });

  it("ignores malformed JSONL lines without crashing", async () => {
    const projDir = path.join(tmpDir, "-project-a");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    const goodLine = jsonlLine(NOW - HOUR, "claude-sonnet-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    await fs.writeFile(file, ["not json at all", "{}", goodLine, ""].join("\n"));
    await fs.utimes(file, NOW / 1000, NOW / 1000);
    const r = await scanCostHistory(tmpDir, NOW);
    expect(r.day).toBeCloseTo(3);
  });

  it("caches results within the TTL window", async () => {
    const projDir = path.join(tmpDir, "-project-a");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    await fs.writeFile(file, jsonlLine(NOW - HOUR, "claude-sonnet-4-20260301", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    await fs.utimes(file, NOW / 1000, NOW / 1000);
    const first = await scanCostHistory(tmpDir, NOW);
    // Second call without advancing `now` past the cache TTL should hit cache —
    // even after we delete the underlying file.
    await fs.rm(file);
    const second = await scanCostHistory(tmpDir, NOW + 1000);
    expect(second).toEqual(first);
  });

  it("two concurrent cache-miss calls return the same result object (in-flight dedupe)", async () => {
    // Use a unique `now` far in the future so the cache is guaranteed cold.
    // Both calls are fired before either resolves; with in-flight dedupe they
    // share a single promise and therefore resolve to the *same* object reference.
    const uniqueNow = NOW + 999_999_999;
    const projDir = path.join(tmpDir, "-project-dedup");
    await fs.mkdir(projDir, { recursive: true });
    const file = path.join(projDir, "session.jsonl");
    await fs.writeFile(file, jsonlLine(uniqueNow - HOUR, "claude-sonnet-4-20260301", {
      input_tokens: 0, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    }));
    await fs.utimes(file, uniqueNow / 1000, uniqueNow / 1000);

    // Fire both simultaneously — neither has resolved yet.
    const [r1, r2] = await Promise.all([
      scanCostHistory(tmpDir, uniqueNow),
      scanCostHistory(tmpDir, uniqueNow),
    ]);

    // With dedupe both calls share a single scan promise → same object reference.
    // Without dedupe they each create independent CostBuckets objects (toBe fails).
    expect(r1).toBe(r2);
  });
});
