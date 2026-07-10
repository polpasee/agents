import { NextResponse } from "next/server";
import { HOOK_MAX_BODY_BYTES } from "../../../../../scripts/lib/config";
import { isAllowedRequestOrigin } from "../../../../../scripts/lib/origin-check";
import { dispatchHookEvent } from "../../../../../scripts/lib/hook-ingest";

export const dynamic = "force-dynamic";

// Receives Claude Code hook payloads (SessionStart, Pre/PostToolUse,
// SubagentStop, Stop, SessionEnd, Notification, …) and drives the push
// lifecycle. Uses the request-origin guard (not the mutating one): the hook
// client is curl with no Origin header, which the mutating guard rejects;
// this still refuses a present non-localhost/LAN Origin. Always 200 so a hook
// never surfaces an error in Claude Code.
export async function POST(request: Request): Promise<Response> {
  if (!isAllowedRequestOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > HOOK_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
  }

  let raw: unknown;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > HOOK_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  dispatchHookEvent(raw as Record<string, unknown>);
  return NextResponse.json({ ok: true }, { status: 200 });
}
