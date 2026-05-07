"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { WS_URL, WS_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_DELAY_MS, WS_BATCH_INTERVAL_MS, WS_BATCH_MAX_SIZE } from "@/lib/config";
import type { ClientEvent } from "@/lib/types";
import { PROTOCOL_VERSION } from "@/lib/types";
import { isValidServerEvent } from "@/lib/validation";

/** Module-level reference to the active WebSocket for sending messages */
let activeWs: WebSocket | null = null;
/** Queue messages when disconnected, flush on reconnect */
const messageQueue: ClientEvent[] = [];

/** Send a ClientEvent message through the WebSocket connection */
export function sendWsMessage(event: ClientEvent) {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.send(JSON.stringify(event));
  } else {
    messageQueue.push(event);
  }
}

/** Connect to the agent WebSocket server with exponential backoff reconnection.
 *  The connection persists across replay toggles — we just drop live events while
 *  replay is active. Tearing down the WS on every replay toggle would lose the
 *  in-flight event buffer and reset backoff state. */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let heartbeatTimer: ReturnType<typeof setInterval>;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let eventBuffer: Array<{ event: import("@/lib/types").AgentEvent; timestamp: number }> = [];
    let destroyed = false;
    let reconnectDelay = WS_RECONNECT_DELAY_MS;
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
      if (eventBuffer.length >= WS_BATCH_MAX_SIZE) {
        if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
        flushEventBuffer();
      } else if (batchTimer === null) {
        batchTimer = setTimeout(flushEventBuffer, WS_BATCH_INTERVAL_MS);
      }
    }

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(`${WS_URL}?role=viewer`);
      wsRef.current = ws;
      activeWs = ws;

      ws.onopen = () => {
        reconnectDelay = WS_RECONNECT_DELAY_MS;
        useAgentStore.getState().setConnected(true);
        // Flush queued messages
        while (messageQueue.length > 0) {
          const queued = messageQueue.shift()!;
          ws.send(JSON.stringify(queued));
        }
        // Start heartbeat
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (!isValidServerEvent(data)) {
            console.warn("Invalid ServerEvent received:", data?.type);
            return;
          }
          const event = data;
          // Heartbeat reply from the server — transport-level, no app state to update.
          if (event.type === "pong") return;
          const store = useAgentStore.getState();
          // Drop live state deltas during replay — viewers are watching recorded history.
          // Annotations and log responses still flow through so collaborators see updates.
          const replayActive = store.replay.active;
          switch (event.type) {
            case "state:sync":
              if (!protocolWarned && event.protocolVersion !== PROTOCOL_VERSION) {
                console.warn(
                  `WS protocol version mismatch: server=${event.protocolVersion ?? "unset"}, client=${PROTOCOL_VERSION}. Continuing.`,
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
        } catch (err) {
          console.warn("Failed to parse WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        activeWs = null;
        useAgentStore.getState().setConnected(false);
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, WS_RECONNECT_MAX_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      if (batchTimer !== null) clearTimeout(batchTimer);
      flushEventBuffer();
      activeWs = null;
      wsRef.current?.close();
    };
  }, []);
}
