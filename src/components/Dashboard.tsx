"use client";

import { useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useReplay } from "@/hooks/useReplay";
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
import { ReplayBar } from "./ReplayBar";
import LogViewer from "./LogViewer";
import { ErrorDrillDown } from "./ErrorDrillDown";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { ErrorBoundary } from "./ErrorBoundary";

export function Dashboard() {
  useWebSocket();
  useReplay();
  useSoundNotifications();
  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
  const viewMode = useAgentStore((s) => s.viewMode);
  const connected = useAgentStore((s) => s.connected);
  const agentCount = useAgentStore((s) => s.agents.size);
  const replayActive = useAgentStore((s) => s.replay.active);
  const logViewerAgentId = useAgentStore((s) => s.logViewerAgentId);

  return (
    <div id="main-content" className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <ErrorBoundary>
        <TopBar />
      </ErrorBoundary>
      <div className="flex flex-1 min-h-0">
        <ErrorBoundary>
          <AgentList />
        </ErrorBoundary>
        <div className="relative flex-1 h-full">
          {!connected && agentCount === 0 && !replayActive ? (
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
            <ErrorBoundary>
              <AgentGraph ref={graphRef} />
              <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
              <MiniMap graphRef={graphRef} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary>
              <Timeline />
            </ErrorBoundary>
          )}
        </div>
        <ErrorBoundary>
          <AgentDetail />
        </ErrorBoundary>
      </div>
      <ErrorBoundary>
        <TeamPanel />
      </ErrorBoundary>
      {replayActive && (
        <ErrorBoundary>
          <ReplayBar />
        </ErrorBoundary>
      )}
      <ErrorBoundary>
        <ActivityStream />
      </ErrorBoundary>
      {logViewerAgentId && (
        <ErrorBoundary>
          <LogViewer />
        </ErrorBoundary>
      )}
      <ErrorDrillDown />
    </div>
  );
}
