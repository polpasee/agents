"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { STREAM_BATCH_INTERVAL_MS, STREAM_BATCH_MAX_SIZE } from "@/lib/config";
import { PROTOCOL_VERSION } from "@/lib/types";
import { isValidServerEvent } from "@/lib/validation";

/**
 * Subscribe to the server's live state stream via SSE.
 *
 * EventSource handles reconnect natively; we only own the per-event dispatch
 * into the Zustand store, with a small batch buffer for state:update events
 * to coalesce render churn.
 */
export function useEventStream() {
  useEffect(() => {
    let destroyed = false;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let eventBuffer: Array<{ event: import("@/lib/types").AgentEvent; timestamp: number }> = [];
    let protocolWarned = false;

    function flushEventBuffer() {
      if (destroyed) return;
      if (eventBuffer.length === 0) return;
      const batch = eventBuffer;
      eventBuffer = [];
      batchTimer = null;
      const state = useAgentStore.getState();
      // Replay may have been toggled on between enqueue and flush; drop the
      // buffered deltas — the next replay-deactivate triggers a fresh sync.
      if (state.replay.active) return;
      const { handleEvent } = state;
      for (const { event, timestamp } of batch) {
        handleEvent(event, timestamp);
      }
    }

    function enqueueEvent(event: import("@/lib/types").AgentEvent, timestamp: number) {
      eventBuffer.push({ event, timestamp });
      if (eventBuffer.length >= STREAM_BATCH_MAX_SIZE) {
        if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
        flushEventBuffer();
      } else if (batchTimer === null) {
        batchTimer = setTimeout(flushEventBuffer, STREAM_BATCH_INTERVAL_MS);
      }
    }

    const es = new EventSource("/api/stream");

    es.onopen = () => {
      if (destroyed) return;
      useAgentStore.getState().setConnected(true);
    };

    es.onerror = () => {
      if (destroyed) return;
      // EventSource auto-reconnects; just reflect the transient disconnect.
      useAgentStore.getState().setConnected(false);
    };

    es.onmessage = (msg) => {
      if (destroyed) return;
      let data: unknown;
      try { data = JSON.parse(msg.data); }
      catch { return; }

      if (!isValidServerEvent(data)) return;
      const event = data;
      const store = useAgentStore.getState();
      const replayActive = store.replay.active;

      switch (event.type) {
        case "state:sync":
          if (!protocolWarned && event.protocolVersion !== PROTOCOL_VERSION) {
            console.warn(
              `Stream protocol version mismatch: server=${event.protocolVersion ?? "unset"}, client=${PROTOCOL_VERSION}. Continuing.`,
            );
            protocolWarned = true;
          }
          // Drop any buffered deltas from the pre-disconnect connection — they
          // reference the old snapshot and would corrupt the fresh one.
          if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
          eventBuffer = [];
          if (!replayActive) store.syncState(event.agents, event.edges, event.teams);
          break;
        case "state:update":
          if (!replayActive) enqueueEvent(event.event, event.timestamp);
          break;
        case "state:remove":
          if (!replayActive) store.removeAgent(event.agentId);
          break;
        // Annotations are independent of the replay timeline (replay only
        // scrubs agents/edges/teams), so they always apply live — gating them
        // would drop annotation deltas with no resync path on replay exit.
        case "annotation:sync":
          store.replaceAnnotations(event.annotations);
          break;
        case "annotation:update":
          if (event.action === "add") store.addAnnotation(event.annotation);
          else store.removeAnnotation(event.annotation.id);
          break;
      }
    };

    return () => {
      destroyed = true;
      if (batchTimer !== null) clearTimeout(batchTimer);
      flushEventBuffer();
      es.close();
      useAgentStore.getState().setConnected(false);
    };
  }, []);
}
