import { NextResponse } from "next/server";
// PROJECTS_DIR (scripts/lib/config.ts) — the durable record of every
// Claude Code session; the scanner tolerates a missing dir.
import { PROJECTS_DIR } from "../../../../scripts/lib/config";
import { scanCostHistory } from "../../../../scripts/lib/cost-history";
import { isAllowedRequestOrigin } from "../../../../scripts/lib/origin-check";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const buckets = await scanCostHistory(PROJECTS_DIR);
    return NextResponse.json(buckets);
  } catch (err) {
    console.warn("/api/costs failed:", err);
    return NextResponse.json(
      { error: "Failed to read cost history" },
      { status: 500 },
    );
  }
}
