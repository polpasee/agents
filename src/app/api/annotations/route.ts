import { NextResponse } from "next/server";
import {
  annotations,
  sanitizeAnnotation,
} from "../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../scripts/lib/sse-broadcast";
import { ANNOTATION_MAX_ENTRIES } from "../../../../scripts/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ann = sanitizeAnnotation(raw);
  if (!ann) {
    return NextResponse.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  if (annotations.has(ann.id)) {
    return NextResponse.json({ error: "Annotation id already exists" }, { status: 409 });
  }

  while (annotations.size >= ANNOTATION_MAX_ENTRIES) {
    const oldest = annotations.keys().next().value;
    if (oldest === undefined) break;
    annotations.delete(oldest);
  }

  annotations.set(ann.id, ann);
  broadcast({ type: "annotation:update", action: "add", annotation: ann });

  return NextResponse.json({ annotation: ann }, { status: 201 });
}
