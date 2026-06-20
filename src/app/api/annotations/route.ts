import { NextResponse } from "next/server";
import {
  annotations,
  sanitizeAnnotation,
} from "../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../scripts/lib/sse-broadcast";
import {
  ANNOTATION_MAX_ENTRIES,
  ANNOTATION_MAX_BODY_BYTES,
} from "../../../../scripts/lib/config";
import { isAllowedMutatingOrigin } from "../../../../scripts/lib/origin-check";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedMutatingOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  // DoS guard: bound body size before parsing. Prefer Content-Length when
  // present; otherwise read the full buffer and check byteLength so a client
  // that omits the header cannot stream an unbounded payload at us.
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > ANNOTATION_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
  }

  let raw: unknown;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > ANNOTATION_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }
    const text = new TextDecoder().decode(buf);
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ann = sanitizeAnnotation(raw);
  if (!ann) {
    return NextResponse.json(
      { error: "Invalid annotation payload" },
      { status: 400 },
    );
  }

  if (annotations.has(ann.id)) {
    return NextResponse.json(
      { error: "Annotation id already exists" },
      { status: 409 },
    );
  }

  while (annotations.size >= ANNOTATION_MAX_ENTRIES) {
    const oldestKey = annotations.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = annotations.get(oldestKey);
    annotations.delete(oldestKey);
    if (evicted) {
      broadcast({
        type: "annotation:update",
        action: "remove",
        annotation: evicted,
      });
    }
  }

  annotations.set(ann.id, ann);
  broadcast({ type: "annotation:update", action: "add", annotation: ann });

  return NextResponse.json({ annotation: ann }, { status: 201 });
}
