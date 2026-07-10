import { NextResponse } from "next/server";
import { OTLP_MAX_BODY_BYTES } from "../../../../../../scripts/lib/config";
import { isAllowedRequestOrigin } from "../../../../../../scripts/lib/origin-check";
import { ingestOtlpLogs } from "../../../../../../scripts/lib/otlp-ingest";

export const dynamic = "force-dynamic";

// OTLP/HTTP logs sink. Claude Code (OTEL_EXPORTER_OTLP_ENDPOINT=.../api/otlp)
// appends /v1/logs; Codex points its full URL here. Accepts JSON only
// (OTEL_EXPORTER_OTLP_PROTOCOL=http/json). Uses the request-origin guard — the
// exporter sends no Origin header. Returns 200 on accept so the exporter does
// not treat ingestion as failed and retry/backoff.
export async function POST(request: Request): Promise<Response> {
  if (!isAllowedRequestOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > OTLP_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
  }

  let raw: unknown;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > OTLP_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  ingestOtlpLogs(raw);
  return NextResponse.json({}, { status: 200 });
}
