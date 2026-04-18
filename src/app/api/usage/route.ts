import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const USAGE_PATH = path.join(os.homedir(), ".claude", "usage-status.json");
/** Data older than this is surfaced to the UI as "stale" — Claude Code only
 *  refreshes usage-status.json when rate-limit headers come back, and newer
 *  versions have stopped writing it entirely, so an hour is a liberal bound. */
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = fs.readFileSync(USAGE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!data) return NextResponse.json(null);

    // resets_at from Claude Code is Unix seconds — convert to ISO string
    const blockResetAt = typeof data.blockResetAt === "number"
      ? new Date(data.blockResetAt * 1000).toISOString()
      : data.blockResetAt;
    const weeklyResetAt = typeof data.weeklyResetAt === "number"
      ? new Date(data.weeklyResetAt * 1000).toISOString()
      : data.weeklyResetAt;

    const timestamp: number | null = typeof data.timestamp === "number" ? data.timestamp : null;
    const ageMs = timestamp != null ? Date.now() - timestamp : null;
    const stale = ageMs != null ? ageMs > STALENESS_THRESHOLD_MS : true;

    return NextResponse.json({
      blockPercent: data.blockPercent ?? null,
      weeklyPercent: data.weeklyPercent ?? null,
      blockResetAt,
      weeklyResetAt,
      timestamp,
      ageMs,
      stale,
    });
  } catch {
    return NextResponse.json(null);
  }
}
