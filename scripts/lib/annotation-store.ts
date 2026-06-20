import type { Annotation } from "../../src/lib/types";
import { ANNOTATION_MAX_TEXT_LENGTH, ANNOTATION_ID_PATTERN } from "./config";

declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorAnnotations: Map<string, Annotation> | undefined;
}

export const annotations: Map<string, Annotation> =
  (globalThis.__agentMonitorAnnotations ??= new Map());

/** Validate and normalize untrusted annotation input.
 *  Returns null on any malformed field — callers must treat null as a 400. */
export function sanitizeAnnotation(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ANNOTATION_ID_PATTERN.test(o.id))
    return null;
  if (
    typeof o.targetId !== "string" ||
    o.targetId.length === 0 ||
    o.targetId.length > 128
  )
    return null;
  if (o.targetType !== "agent" && o.targetType !== "edge") return null;
  if (
    typeof o.text !== "string" ||
    o.text.length === 0 ||
    o.text.length > ANNOTATION_MAX_TEXT_LENGTH
  )
    return null;
  if (typeof o.timestamp !== "number" || !Number.isFinite(o.timestamp))
    return null;
  const author =
    typeof o.author === "string" && o.author.length <= 64
      ? o.author
      : undefined;
  const x = typeof o.x === "number" && Number.isFinite(o.x) ? o.x : undefined;
  const y = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : undefined;
  return {
    id: o.id,
    targetId: o.targetId,
    targetType: o.targetType,
    text: o.text,
    timestamp: o.timestamp,
    author,
    x,
    y,
  };
}
