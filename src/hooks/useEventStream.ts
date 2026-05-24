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
      if (eventBuffer.length === 0) return;
      const batch = eventBuffer;
      eventBuffer = [];
      batchTimer = null;
      const { handleEvent } = useAgentStore.getState();
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
          if (!replayActive) store.syncState(event.agents, event.edges, event.teams);
          break;
        case "state:update":
          if (!replayActive) enqueueEvent(event.event, event.timestamp);
          break;
        case "state:remove":
          if (!replayActive) store.removeAgent(event.agentId);
          break;
        case "log:response":
          store.setLogEntries(event.agentId, event.entries);
          break;
        case "log:error":
          store.setLogLoading(event.agentId, false);
          console.warn("Log fetch error for agent", event.agentId, ":", event.error);
          break;
        case "annotation:sync":
          for (const ann of event.annotations) store.addAnnotation(ann);
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
