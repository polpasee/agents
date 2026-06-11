import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// ccstatusline writes fresh data to CCSTATUSLINE_CACHE every ~3 minutes. The
// startBackgroundTasks usage poll loop owns refresh cadence (see
// scripts/lib/ccstatusline.ts). This route is a pure cache reader — no spawn,
// no side effects, idempotent GET.
import { CCSTATUSLINE_CACHE } from "../../../../scripts/lib/ccstatusline";

/** Legacy fallback: Claude Code's own file. Older versions wrote it when
 *  rate-limit headers came back; newer versions have stopped writing it
 *  entirely, so it is usually stale or missing. */
const LEGACY_USAGE_PATH = path.join(os.homedir(), ".claude", "usage-status.json");

/** Mark the panel stale once data is older than this. */
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000;

export const dynamic = "force-dynamic";

interface UsagePayload {
  blockPercent: number | null;
  weeklyPercent: number | null;
  blockResetAt: string | null;
  weeklyResetAt: string | null;
  timestamp: number | null;
  ageMs: number | null;
  stale: boolean;
}

function readCcstatuslineCache(): UsagePayload | null {
  try {
    const stat = fs.statSync(CCSTATUSLINE_CACHE);
    const raw = fs.readFileSync(CCSTATUSLINE_CACHE, "utf-8");
    const data = JSON.parse(raw);
    if (data?.sessionUsage == null && data?.weeklyUsage == null) return null;
    const timestamp = stat.mtimeMs;
    const ageMs = Date.now() - timestamp;
    return {
      blockPercent: data.sessionUsage ?? null,
      weeklyPercent: data.weeklyUsage ?? null,
      blockResetAt: data.sessionResetAt ?? null,
      weeklyResetAt: data.weeklyResetAt ?? null,
      timestamp,
      ageMs,
      stale: ageMs > STALENESS_THRESHOLD_MS,
    };
  } catch {
    return null;
  }
}

function readLegacyUsage(): UsagePayload | null {
  try {
    const raw = fs.readFileSync(LEGACY_USAGE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!data) return null;

    // resets_at from Claude Code is Unix seconds — convert to ISO string
    const blockResetAt = typeof data.blockResetAt === "number"
      ? new Date(data.blockResetAt * 1000).toISOString()
      : data.blockResetAt ?? null;
    const weeklyResetAt = typeof data.weeklyResetAt === "number"
      ? new Date(data.weeklyResetAt * 1000).toISOString()
      : data.weeklyResetAt ?? null;

    const timestamp: number | null = typeof data.timestamp === "number" ? data.timestamp : null;
    const ageMs = timestamp != null ? Date.now() - timestamp : null;
    const stale = ageMs != null ? ageMs > STALENESS_THRESHOLD_MS : true;

    return {
      blockPercent: data.blockPercent ?? null,
      weeklyPercent: data.weeklyPercent ?? null,
      blockResetAt,
      weeklyResetAt,
      timestamp,
      ageMs,
      stale,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const payload = readCcstatuslineCache() ?? readLegacyUsage();
  return NextResponse.json(payload);
}
