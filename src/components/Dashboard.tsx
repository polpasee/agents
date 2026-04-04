"use client";

import { useRef, useState, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useReplay } from "@/hooks/useReplay";
import { useSoundNotifications } from "@/hooks/useSoundNotifications";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TopBar } from "./TopBar";
import { AgentList } from "./AgentList";
import { AgentGraph } from "./AgentGraph";
import type { AgentGraphHandle } from "./AgentGraph";
import { AgentDetail } from "./AgentDetail";
import { TimelineBar } from "./TimelineBar";
import { GraphControls } from "./GraphControls";
import { Timeline } from "./Timeline";
import { TranscriptPanel } from "./TranscriptPanel";
import { FileAttentionPanel } from "./FileAttentionPanel";
import { TeamPanel } from "./TeamPanel";
import { ActivityStream } from "./ActivityStream";
import { ReplayBar } from "./ReplayBar";
import { LogViewer } from "./LogViewer";
import { ErrorDrillDown } from "./ErrorDrillDown";
import { LiveMetrics } from "./LiveMetrics";
import { ExportModal } from "./ExportModal";
import { DiffViewer } from "./DiffViewer";
import { SessionComparison } from "./SessionComparison";
import { useMetricSampler } from "@/hooks/useMetricSampler";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { ErrorBoundary } from "./ErrorBoundary";

export function Dashboard() {
  useWebSocket();
  useReplay();
  useMetricSampler();
  useSoundNotifications();

  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
  const viewMode = useAgentStore((s) => s.viewMode);
  const connected = useAgentStore((s) => s.connected);
  const agentCount = useAgentStore((s) => s.agents.size);
  const transcriptOpen = useAgentStore((s) => s.transcriptOpen);
  const toggleTranscript = useAgentStore((s) => s.toggleTranscript);
  const fileAttentionOpen = useAgentStore((s) => s.fileAttentionOpen);
  const toggleFileAttention = useAgentStore((s) => s.toggleFileAttention);
  const replayActive = useAgentStore((s) => s.replay.active);
  const logViewerAgentId = useAgentStore((s) => s.logViewerAgentId);
  const comparison = useAgentStore((s) => s.comparison);
  const exitComparison = useAgentStore((s) => s.exitComparison);
  const agents = useAgentStore((s) => s.agents);

  const [mobileAgentList, setMobileAgentList] = useState(false);
  const [mobileAgentDetail, setMobileAgentDetail] = useState(false);
  const closePanels = useCallback(() => {
    setMobileAgentList(false);
    setMobileAgentDetail(false);
  }, []);

  return (
    <div id="main-content" className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <ErrorBoundary>
        <TopBar />
      </ErrorBoundary>
      <LiveMetrics />

      {comparison.active && comparison.leftSession && comparison.rightSession ? (
        <SessionComparison
          leftSession={comparison.leftSession}
          rightSession={comparison.rightSession}
          agents={agents}
          onExit={exitComparison}
        />
      ) : (
      <>
      {/* Mobile toggle buttons */}
      <div className="mobile-toggle-btn items-center gap-2 px-2 py-1" style={{ background: "var(--color-panel)", borderBottom: "1px solid var(--color-border)" }}>
        <button
          onClick={() => { setMobileAgentList((v) => !v); setMobileAgentDetail(false); }}
          className="px-3 py-1 rounded text-xs font-mono"
          style={{
            background: mobileAgentList ? `${UI.primary}22` : "transparent",
            border: `1px solid ${mobileAgentList ? UI.primary : "var(--color-border)"}`,
            color: mobileAgentList ? UI.primary : UI.text.muted,
          }}
        >
          Agents
        </button>
        <button
          onClick={() => { setMobileAgentDetail((v) => !v); setMobileAgentList(false); }}
          className="px-3 py-1 rounded text-xs font-mono"
          style={{
            background: mobileAgentDetail ? `${UI.primary}22` : "transparent",
            border: `1px solid ${mobileAgentDetail ? UI.primary : "var(--color-border)"}`,
            color: mobileAgentDetail ? UI.primary : UI.text.muted,
          }}
        >
          Details
        </button>
      </div>

      {/* Mobile backdrop */}
      <div
        className={`mobile-backdrop ${mobileAgentList || mobileAgentDetail ? "visible" : ""}`}
        onClick={closePanels}
      />

      <div className="flex flex-1 min-h-0 main-layout">
        <div className={`sidebar-agent-list ${mobileAgentList ? "mobile-open" : ""}`}>
          <ErrorBoundary>
            <AgentList />
          </ErrorBoundary>
        </div>
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
              <GraphControls />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary>
              <Timeline />
            </ErrorBoundary>
          )}
          {transcriptOpen && (
            <TranscriptPanel open={transcriptOpen} onClose={() => toggleTranscript()} />
          )}
          {fileAttentionOpen && (
            <FileAttentionPanel open={fileAttentionOpen} onClose={() => toggleFileAttention()} />
          )}
        </div>
        <div className={`sidebar-agent-detail ${mobileAgentDetail ? "mobile-open" : ""}`}>
          <ErrorBoundary>
            <AgentDetail />
          </ErrorBoundary>
        </div>
      </div>
      <TimelineBar />
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
      </>
      )}
      <ErrorDrillDown />
      <ExportModal />
      <DiffViewer />
    </div>
  );
}
