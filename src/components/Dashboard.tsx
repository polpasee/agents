"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useEventStream } from "@/hooks/useEventStream";
import { useReplay } from "@/hooks/useReplay";
import { useSoundNotifications } from "@/hooks/useSoundNotifications";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TopBar } from "./TopBar";
import { AgentList } from "./AgentList";
import { AgentGraph } from "./AgentGraph";
import type { AgentGraphHandle } from "./AgentGraph";
import { AgentDetail } from "./AgentDetail";
import { TimelineBar } from "./TimelineBar";
import { TopologyUsageStatus } from "./TopologyUsageStatus";
import { TranscriptPanel } from "./TranscriptPanel";
import { FileAttentionPanel } from "./FileAttentionPanel";
import { TeamPanel } from "./TeamPanel";
import { ActivityStream } from "./ActivityStream";
import { ReplayBar } from "./ReplayBar";
import { LogViewer } from "./LogViewer";
import { ErrorDrillDown } from "./ErrorDrillDown";
import { ExportModal } from "./ExportModal";
import { LayoutTuningPanel } from "./LayoutTuningPanel";
import { DiffViewer } from "./DiffViewer";
import { SessionComparison } from "./SessionComparison";
import { useMetricSampler } from "@/hooks/useMetricSampler";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { ErrorBoundary } from "./ErrorBoundary";

export function Dashboard() {
  useEventStream();
  useReplay();
  useMetricSampler();
  useSoundNotifications();

  // Hydrate UI state from localStorage after client mount to avoid SSR mismatch
  const hydrateUI = useAgentStore((s) => s.hydrateUI);
  useEffect(() => {
    hydrateUI();
  }, [hydrateUI]);

  // Default the topology to All Sessions on first agent arrival; user can pick a subset
  // via the sidebar pills. Skipped if the user has already made a choice in a prior visit
  // (hydrated from storage), unless the stored filter no longer matches any live session.
  const sessionFilterInitialized = useAgentStore(
    (s) => s.sessionFilterInitialized,
  );
  const autoSelectInitialSession = useAgentStore(
    (s) => s.autoSelectInitialSession,
  );
  const agentsForInit = useAgentStore((s) => s.agents);
  useEffect(() => {
    if (sessionFilterInitialized) return;
    if (agentsForInit.size === 0) return;
    autoSelectInitialSession();
  }, [sessionFilterInitialized, agentsForInit, autoSelectInitialSession]);

  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
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
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const filteredAgents = useFilteredAgents();

  const [mobileAgentList, setMobileAgentList] = useState(false);
  const [mobileAgentDetail, setMobileAgentDetail] = useState(false);
  const closePanels = useCallback(() => {
    setMobileAgentList(false);
    setMobileAgentDetail(false);
  }, []);

  // If the selected agent is no longer visible, clear it so the detail panel
  // doesn't render against a missing agent. Selection is a view concern bound
  // to useFilteredAgents — keep this here, not in the store.
  useEffect(() => {
    if (selectedAgentId === null) return;
    if (!filteredAgents.some((a) => a.id === selectedAgentId)) {
      selectAgent(null);
    }
  }, [selectedAgentId, filteredAgents, selectAgent]);

  // On narrow viewports the Agents/Details panels are hidden off-screen until
  // their tab button is tapped. Without this, selecting an agent (in the graph
  // or the agents list) updates state silently and the user sees no feedback.
  useEffect(() => {
    if (selectedAgentId) {
      setMobileAgentDetail(true);
      setMobileAgentList(false);
    } else {
      setMobileAgentDetail(false);
    }
  }, [selectedAgentId]);

  return (
    <div
      id="main-content"
      className="flex flex-col h-screen"
      style={{ background: "var(--color-bg)" }}
    >
      <ErrorBoundary>
        <TopBar />
      </ErrorBoundary>

      {comparison.active &&
      comparison.leftSession &&
      comparison.rightSession ? (
        <SessionComparison
          leftSession={comparison.leftSession}
          rightSession={comparison.rightSession}
          agents={agents}
          onExit={exitComparison}
        />
      ) : (
        <>
          {/* Mobile backdrop */}
          <div
            className={`mobile-backdrop ${mobileAgentList || mobileAgentDetail ? "visible" : ""}`}
            onClick={closePanels}
          />

          <div className="flex flex-1 min-h-0 main-layout">
            <div
              className={`sidebar-agent-list ${mobileAgentList ? "mobile-open" : ""}`}
            >
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
                      style={{
                        borderColor: `${UI.primary}33`,
                        borderTopColor: UI.primary,
                      }}
                    />
                    <div
                      className="text-sm font-mono"
                      style={{ color: UI.text.muted }}
                    >
                      Connecting to agent monitor...
                    </div>
                  </div>
                </div>
              ) : (
                <ErrorBoundary>
                  <AgentGraph ref={graphRef} />
                  <TopologyUsageStatus />
                </ErrorBoundary>
              )}
              {transcriptOpen && (
                <TranscriptPanel
                  open={transcriptOpen}
                  onClose={() => toggleTranscript()}
                />
              )}
              {fileAttentionOpen && (
                <FileAttentionPanel
                  open={fileAttentionOpen}
                  onClose={() => toggleFileAttention()}
                />
              )}
            </div>
            <div
              className={`sidebar-agent-detail ${mobileAgentDetail ? "mobile-open" : ""}`}
            >
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
      <LayoutTuningPanel />
      <DiffViewer />
    </div>
  );
}
