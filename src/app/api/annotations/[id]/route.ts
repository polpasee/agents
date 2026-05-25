import { NextResponse } from "next/server";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../../scripts/lib/sse-broadcast";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const existing = annotations.get(id);
  if (!existing) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  annotations.delete(id);
  broadcast({ type: "annotation:update", action: "remove", annotation: existing });
  return new Response(null, { status: 204 });
}
