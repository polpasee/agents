"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { WS_URL, WS_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_DELAY_MS } from "@/lib/config";
import type { ServerEvent, ClientEvent } from "@/lib/types";
import { isValidServerEvent } from "@/lib/validation";

/** Module-level reference to the active WebSocket for sending messages */
let activeWs: WebSocket | null = null;

/** Send a ClientEvent message through the WebSocket connection */
export function sendWsMessage(event: ClientEvent) {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.send(JSON.stringify(event));
  } else {
    console.warn("WebSocket not connected, cannot send message:", event.type);
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
  const replayActive = useAgentStore((s) => s.replay.active);

  useEffect(() => {
    // Don't connect to live WebSocket during replay mode
    if (replayActive) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let destroyed = false;
    let reconnectDelay = WS_RECONNECT_DELAY_MS;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(`${WS_URL}?role=viewer`);
      wsRef.current = ws;
      activeWs = ws;

      ws.onopen = () => {
        reconnectDelay = WS_RECONNECT_DELAY_MS;
        setConnected(true);
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
              handleEvent(event.event, event.timestamp);
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
      activeWs = null;
      wsRef.current?.close();
    };
  }, [setConnected, syncState, handleEvent, removeAgent, setLogEntries, setLogLoading, replayActive]);
}
