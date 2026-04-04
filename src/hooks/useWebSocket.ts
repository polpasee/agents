"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { WS_URL, WS_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_DELAY_MS, WS_BATCH_INTERVAL_MS, WS_BATCH_MAX_SIZE } from "@/lib/config";
import type { ServerEvent, ClientEvent } from "@/lib/types";
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

/** Connect to the agent WebSocket server with exponential backoff reconnection. */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const setConnected = useAgentStore((s) => s.setConnected);
  const syncState = useAgentStore((s) => s.syncState);
  const handleEvent = useAgentStore((s) => s.handleEvent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const setLogEntries = useAgentStore((s) => s.setLogEntries);
  const setLogLoading = useAgentStore((s) => s.setLogLoading);
  const addAnnotation = useAgentStore((s) => s.addAnnotation);
  const removeAnnotation = useAgentStore((s) => s.removeAnnotation);
  const replayActive = useAgentStore((s) => s.replay.active);

  useEffect(() => {
    // Don't connect to live WebSocket during replay mode
    if (replayActive) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let heartbeatTimer: ReturnType<typeof setInterval>;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let eventBuffer: Array<{ event: import("@/lib/types").AgentEvent; timestamp: number }> = [];
    let destroyed = false;
    let reconnectDelay = WS_RECONNECT_DELAY_MS;

    function flushEventBuffer() {
      if (eventBuffer.length === 0) return;
      const batch = eventBuffer;
      eventBuffer = [];
      batchTimer = null;
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
        setConnected(true);
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
          switch (event.type) {
            case "state:sync":
              syncState(event.agents, event.edges, event.teams);
              break;
            case "state:update":
              enqueueEvent(event.event, event.timestamp);
              break;
            case "state:remove":
              removeAgent(event.agentId);
              break;
            case "log:response":
              setLogEntries(event.agentId, event.entries);
              break;
            case "log:error":
              setLogLoading(event.agentId, false);
              console.warn("Log fetch error for agent", event.agentId, ":", event.error);
              break;
            case "annotation:sync":
              for (const ann of event.annotations) addAnnotation(ann);
              break;
            case "annotation:update":
              if (event.action === "add") addAnnotation(event.annotation);
              else removeAnnotation(event.annotation.id);
              break;
          }
        } catch (err) {
          console.warn("Failed to parse WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        activeWs = null;
        setConnected(false);
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
  }, [setConnected, syncState, handleEvent, removeAgent, setLogEntries, setLogLoading, addAnnotation, removeAnnotation, replayActive]);
}
