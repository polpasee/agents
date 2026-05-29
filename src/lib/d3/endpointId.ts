import type { SimNode } from "@/lib/d3";

/**
 * Resolve the string id from a SimLink endpoint.
 * d3-force replaces string source/target refs with SimNode objects after the
 * simulation resolves nodes; this helper handles both forms.
 */
export function endpointId(end: string | SimNode): string {
  return typeof end === "string" ? end : end.id;
}
