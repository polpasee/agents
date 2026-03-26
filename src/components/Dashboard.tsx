"use client";

import { useWebSocket } from "@/hooks/useWebSocket";
import { TopBar } from "./TopBar";
import { AgentList } from "./AgentList";
import { AgentGraph } from "./AgentGraph";
import { AgentDetail } from "./AgentDetail";
import { ActivityStream } from "./ActivityStream";

export function Dashboard() {
  useWebSocket();

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <AgentList />
        <AgentGraph />
        <AgentDetail />
      </div>
      <ActivityStream />
    </div>
  );
}
