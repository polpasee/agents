import {
  agents,
  edges,
  teams,
  workflows,
  viewers,
} from "../../../../scripts/lib/agent-state";
import { annotations } from "../../../../scripts/lib/annotation-store";
import { PROTOCOL_VERSION, type ServerEvent } from "@/lib/types";
import type { SSEClient } from "../../../../scripts/lib/sse-broadcast";
import { isAllowedRequestOrigin } from "../../../../scripts/lib/origin-check";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

export function GET(request: Request): Response {
  if (!isAllowedRequestOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  const encoder = new TextEncoder();

  // These are captured in closure so both start() and cancel() can reference them.
  let client: SSEClient | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  function teardown(): void {
    if (keepalive !== null) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (client !== null) {
      viewers.delete(client);
      client = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      client = {
        send(data: string) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
      };
      viewers.add(client);

      // If the client aborts before/during start() or before keepalive is
      // armed, cancel() may not fire — wire the abort signal directly so the
      // viewer is always evicted.
      request.signal.addEventListener("abort", teardown);

      // Wrap initial snapshot enqueues — if the client has already aborted in
      // the same tick, enqueue throws synchronously here. Without the try/catch
      // we'd leak the viewer (cancel() does not fire on a start()-thrown error)
      // and never arm keepalive.
      try {
        const syncEvent: ServerEvent = {
          type: "state:sync",
          agents: Array.from(agents.values()),
          edges: [...edges],
          teams: Array.from(teams.values()),
          workflows: Array.from(workflows.values()),
          protocolVersion: PROTOCOL_VERSION,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(syncEvent)}\n\n`),
        );

        if (annotations.size > 0) {
          const annSync: ServerEvent = {
            type: "annotation:sync",
            annotations: Array.from(annotations.values()),
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(annSync)}\n\n`),
          );
        }
      } catch {
        teardown();
        return;
      }

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          /* stream closed; cancel() removed us */
        }
      }, KEEPALIVE_MS);
    },
    cancel() {
      teardown();
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
