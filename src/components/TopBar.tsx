"use client";

import { useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { UI, STATUS_COLORS } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { calculateTotalCost, formatCost } from "@/lib/costs";
import { CostProjection } from "./CostProjection";
import type { RecordedSession } from "@/lib/types";

export function TopBar() {
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const toggleSession = useAgentStore((s) => s.toggleSession);
  const selectAllSessions = useAgentStore((s) => s.selectAllSessions);
  const viewMode = useAgentStore((s) => s.viewMode);
  const setViewMode = useAgentStore((s) => s.setViewMode);
  const recording = useAgentStore((s) => s.recording);
  const startRecording = useAgentStore((s) => s.startRecording);
  const downloadRecording = useAgentStore((s) => s.downloadRecording);
  const replayActive = useAgentStore((s) => s.replay.active);
  const loadReplaySession = useAgentStore((s) => s.loadReplaySession);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadReplay = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const session = JSON.parse(reader.result as string) as RecordedSession;
        if (session.startTime && Array.isArray(session.events)) {
          loadReplaySession(session);
        }
      } catch (err) {
        console.warn("Failed to load replay file:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset so same file can be reloaded
  };

  const allAgents = Array.from(agents.values());

  // Build session list from main agents (agents without parentId)
  const sessions = allAgents
    .filter((a) => !a.parentId)
    .map((a) => ({
      sessionId: a.sessionId || a.id,
      projectName: (a.metadata?.projectName as string) || a.sessionId || a.id,
      task: a.task,
    }));

  const filteredAgents = useFilteredAgents();

  const total = filteredAgents.length;
  const active = filteredAgents.filter(
    (a) => a.status === "running" || a.status === "waiting"
  ).length;
  const completed = filteredAgents.filter((a) => a.status === "completed").length;
  const errors = filteredAgents.filter((a) => a.status === "error").length;
  const totalCost = calculateTotalCost(agents);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b"
      style={{
        background: "var(--color-panel)",
        borderColor: `${UI.primary}33`,
      }}
    >
      {/* Left: Title + Session Selector */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: connected ? UI.primary : UI.error,
              boxShadow: connected
                ? `0 0 8px ${UI.primary}, 0 0 16px ${UI.primary}66`
                : `0 0 8px ${UI.error}`,
            }}
          />
          <span
            className="text-base font-bold tracking-widest"
            style={{ color: UI.primary, textShadow: `0 0 8px ${UI.primary}66` }}
          >
            AGENT MONITOR
          </span>
          {replayActive ? (
            <span className="text-xs ml-2 animate-pulse-glow" style={{ color: "#eab308" }}>
              REPLAY
            </span>
          ) : !connected ? (
            <span className="text-xs text-red-400 ml-2">
              DISCONNECTED
            </span>
          ) : null}
        </div>

        {/* F5: Multi-session selector */}
        {sessions.length > 0 && (
          <div className="relative" style={{ maxWidth: 280 }}>
            <button
              onClick={selectAllSessions}
              className="text-sm rounded px-2 py-1 cursor-pointer"
              style={{
                background: selectedSessionIds.size === 0 ? `${UI.primary}22` : "var(--color-border)",
                color: selectedSessionIds.size === 0 ? UI.primary : UI.text.secondary,
                border: `1px solid ${UI.primary}33`,
              }}
              title="Show all sessions"
            >
              {selectedSessionIds.size === 0
                ? `All Sessions (${sessions.length})`
                : `${selectedSessionIds.size} of ${sessions.length} sessions`}
            </button>
            <div className="flex gap-1 mt-1 flex-wrap">
              {sessions.map((s) => {
                const label = s.projectName
                  .split("/")
                  .filter(Boolean)
                  .slice(-2)
                  .join("/");
                const isSelected = selectedSessionIds.has(s.sessionId);
                return (
                  <button
                    key={s.sessionId}
                    onClick={() => toggleSession(s.sessionId)}
                    className="text-xs rounded px-1.5 py-0.5 truncate"
                    style={{
                      maxWidth: 140,
                      background: isSelected ? `${UI.primary}22` : "transparent",
                      border: `1px solid ${isSelected ? UI.primary : "var(--color-border)"}`,
                      color: isSelected ? UI.primary : UI.text.muted,
                    }}
                    title={`${label} — ${s.task.slice(0, 60)}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-0.5 ml-2">
          {(["graph", "timeline"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="px-2 py-0.5 rounded text-xs font-mono capitalize"
              style={{
                background: viewMode === mode ? `${UI.primary}22` : "transparent",
                border: `1px solid ${viewMode === mode ? UI.primary : "var(--color-border)"}`,
                color: viewMode === mode ? UI.primary : UI.text.muted,
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          onClick={recording ? downloadRecording : startRecording}
          disabled={replayActive}
          className="px-2 py-0.5 rounded text-xs font-mono ml-2"
          style={{
            background: recording ? `${UI.error}22` : "transparent",
            border: `1px solid ${recording ? UI.error : "var(--color-border)"}`,
            color: recording ? UI.error : UI.text.muted,
            opacity: replayActive ? 0.3 : 1,
          }}
          title={recording ? "Stop & download recording" : "Start recording"}
        >
          REC
        </button>
        <button
          onClick={handleLoadReplay}
          disabled={replayActive}
          className="px-2 py-0.5 rounded text-xs font-mono"
          style={{
            background: "transparent",
            border: `1px solid var(--color-border)`,
            color: UI.text.muted,
            opacity: replayActive ? 0.3 : 1,
          }}
          title="Load a recorded session for replay"
        >
          LOAD
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      {/* Right: Stats */}
      <div className="flex gap-6 text-sm">
        <Stat label="AGENTS" value={total} color={UI.text.secondary} />
        <Stat label="ACTIVE" value={active} color={STATUS_COLORS.running} />
        <Stat label="DONE" value={completed} color={STATUS_COLORS.completed} />
        <Stat label="ERRORS" value={errors} color={UI.error} />
        <CostProjection />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <span style={{ color: UI.text.muted }}>
      {label}:{" "}
      <span style={{ color, textShadow: `0 0 6px ${color}66` }}>{value}</span>
    </span>
  );
}
