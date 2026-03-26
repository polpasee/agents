"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import type { ServerEvent } from "@/lib/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { setConnected, syncState, handleEvent, removeAgent } =
    useAgentStore();

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`${WS_URL}?role=viewer`);
      wsRef.current = ws;

      ws.onopen = () => {
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
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [setConnected, syncState, handleEvent, removeAgent]);
}
