"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { WS_URL, WS_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_DELAY_MS } from "@/lib/config";
import type { ServerEvent } from "@/lib/types";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const setConnected = useAgentStore((s) => s.setConnected);
  const syncState = useAgentStore((s) => s.syncState);
  const handleEvent = useAgentStore((s) => s.handleEvent);
  const removeAgent = useAgentStore((s) => s.removeAgent);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let destroyed = false;
    let reconnectDelay = WS_RECONNECT_DELAY_MS;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(`${WS_URL}?role=viewer`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay = WS_RECONNECT_DELAY_MS;
        setConnected(true);
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as ServerEvent;
          switch (event.type) {
            case "state:sync":
              syncState(event.agents, event.edges);
              break;
            case "state:update":
              handleEvent(event.event, event.timestamp);
              break;
            case "state:remove":
              removeAgent(event.agentId);
              break;
          }
        } catch (err) {
          console.warn("Failed to parse WebSocket message:", err);
        }
      };

      ws.onclose = () => {
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
      wsRef.current?.close();
    };
  }, [setConnected, syncState, handleEvent, removeAgent]);
}
