"use client";

import { useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSoundNotifications } from "@/hooks/useSoundNotifications";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TopBar } from "./TopBar";
import { AgentList } from "./AgentList";
import { AgentGraph } from "./AgentGraph";
import type { AgentGraphHandle } from "./AgentGraph";
import { AgentDetail } from "./AgentDetail";
import { ActivityStream } from "./ActivityStream";
import { GraphControls } from "./GraphControls";

export function Dashboard() {
  useWebSocket();
  useSoundNotifications();
  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <AgentList />
        <div className="relative flex-1 h-full">
          <AgentGraph ref={graphRef} />
          <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
        </div>
        <AgentDetail />
      </div>
      <ActivityStream />
    </div>
  );
}
