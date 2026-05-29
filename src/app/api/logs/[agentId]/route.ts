import { NextResponse } from "next/server";
import { readAgentLog } from "../../../../../scripts/lib/log-reader";
import { getAgentFilePath } from "../../../../../scripts/lib/agent-state";
import { isAllowedRequestOrigin } from "../../../../../scripts/lib/origin-check";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  if (!isAllowedRequestOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  const { agentId } = await params;
  const filePath = getAgentFilePath(agentId);
  if (!filePath) {
    return NextResponse.json(
      { error: "Agent not found or no log file available" },
      { status: 404 },
    );
  }
  try {
    const entries = await readAgentLog(filePath);
    return NextResponse.json({ entries });
  } catch (err) {
    console.warn(`Failed to read log for ${agentId}:`, err);
    return NextResponse.json({ error: "Failed to read log" }, { status: 500 });
  }
}
