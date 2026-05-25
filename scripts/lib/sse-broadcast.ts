import type { ServerEvent } from "../../src/lib/types";

/** Anything we can write SSE frames to. Adapter shape for both real
 *  ReadableStream controllers and test doubles. */
export interface SSEClient {
  send(data: string): void;
}

// HMR-safe singleton — Next.js dev re-evaluates modules on file save, so the
// viewers set must live on globalThis to survive hot reloads.
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorViewers: Set<SSEClient> | undefined;
}

export const viewers: Set<SSEClient> = (globalThis.__agentMonitorViewers ??= new Set());

/** Fan out a server event as a stringified payload to every connected viewer. */
export function broadcast(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const viewer of viewers) {
    try {
      viewer.send(payload);
    } catch {
      // A disconnected viewer throws on send before cancel() fires (or when
      // the route never wired its abort handler). Evict here so broadcast()
      // can't accumulate orphans across the HMR-stable globalThis singleton.
      viewers.delete(viewer);
    }
  }
}
