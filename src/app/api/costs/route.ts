import { NextResponse } from "next/server";
import * as os from "node:os";
import * as path from "node:path";
import { scanCostHistory } from "../../../../scripts/lib/cost-history";

/** Mirrors the WS-server's PROJECTS_DIR — the durable record of every
 *  Claude Code session. Kept hard-coded (not env-driven) to match the
 *  ws-server convention; the scanner tolerates a missing dir. */
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const buckets = await scanCostHistory(PROJECTS_DIR);
    return NextResponse.json(buckets);
  } catch (err) {
    console.warn("/api/costs failed:", err);
    return NextResponse.json({ error: "Failed to read cost history" }, { status: 500 });
  }
}
