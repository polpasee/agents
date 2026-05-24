import {
  agents,
  edges,
  teams,
  viewers,
} from "../../../../scripts/lib/agent-state";
import { annotations } from "../../../../scripts/lib/annotation-store";
import { PROTOCOL_VERSION, type ServerEvent } from "../../../../src/lib/types";
import type { SSEClient } from "../../../../scripts/lib/sse-broadcast";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

export function GET(_request: Request): Response {
  const encoder = new TextEncoder();

  // These are captured in closure so both start() and cancel() can reference them.
  let client: SSEClient | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      client = {
        send(data: string) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
      };
      viewers.add(client);

      // Initial snapshot
      const syncEvent: ServerEvent = {
        type: "state:sync",
        agents: Array.from(agents.values()),
        edges: [...edges],
        teams: Array.from(teams.values()),
        protocolVersion: PROTOCOL_VERSION,
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(syncEvent)}\n\n`));

      if (annotations.size > 0) {
        const annSync: ServerEvent = {
          type: "annotation:sync",
          annotations: Array.from(annotations.values()),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(annSync)}\n\n`));
      }

      keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
        catch { /* stream closed; cancel() removed us */ }
      }, KEEPALIVE_MS);
    },
    cancel() {
      if (keepalive !== null) clearInterval(keepalive);
      if (client !== null) viewers.delete(client);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
