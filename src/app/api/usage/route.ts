import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const USAGE_PATH = path.join(os.homedir(), ".claude", "usage-status.json");

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

    return NextResponse.json({
      blockPercent: data.blockPercent ?? null,
      weeklyPercent: data.weeklyPercent ?? null,
      blockResetAt,
      weeklyResetAt,
      timestamp: data.timestamp ?? null,
    });
  } catch {
    return NextResponse.json(null);
  }
}
