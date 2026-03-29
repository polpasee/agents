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
import { MiniMap } from "./MiniMap";
import { Timeline } from "./Timeline";
import { TeamPanel } from "./TeamPanel";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";

export function Dashboard() {
  useWebSocket();
  useSoundNotifications();
  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
  const viewMode = useAgentStore((s) => s.viewMode);
  const connected = useAgentStore((s) => s.connected);
  const agentCount = useAgentStore((s) => s.agents.size);

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <AgentList />
        <div className="relative flex-1 h-full">
          {!connected && agentCount === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div
                  className="inline-block w-6 h-6 rounded-full border-2 animate-spin mb-3"
                  style={{ borderColor: `${UI.primary}33`, borderTopColor: UI.primary }}
                />
                <div className="text-sm font-mono" style={{ color: UI.text.muted }}>
                  Connecting to agent monitor...
                </div>
              </div>
            </div>
          ) : viewMode === "graph" ? (
            <>
              <AgentGraph ref={graphRef} />
              <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
              <MiniMap graphRef={graphRef} />
            </>
          ) : (
            <Timeline />
          )}
        </div>
        <AgentDetail />
      </div>
      <TeamPanel />
      <ActivityStream />
    </div>
  );
}
