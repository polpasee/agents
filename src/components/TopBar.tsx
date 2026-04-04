"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import { UI, STATUS_COLORS } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { calculateTotalCost } from "@/lib/costs";
import { CostProjection } from "./CostProjection";

export function TopBar() {
  const { agents, connected, viewMode } =
    useAgentStore(useShallow((s) => ({
      agents: s.agents, connected: s.connected, viewMode: s.viewMode,
    })));
  const replayActive = useAgentStore((s) => s.replay.active);
  const setViewMode = useAgentStore((s) => s.setViewMode);

  const filteredAgents = useFilteredAgents();

  const { total, active, completed, errors } = useMemo(() => {
    const total = filteredAgents.length;
    const active = filteredAgents.filter((a) => a.status === "running" || a.status === "waiting").length;
    const completed = filteredAgents.filter((a) => a.status === "completed").length;
    const errors = filteredAgents.filter((a) => a.status === "error").length;
    return { total, active, completed, errors };
  }, [filteredAgents]);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b topbar-responsive"
      style={{
        background: "var(--color-panel)",
        borderColor: `${UI.primary}33`,
      }}
    >
      {/* Left: Title */}
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

      </div>

      {/* Right: Stats */}
      <div className="flex items-center gap-6 text-xs topbar-stats">
        <Stat label="AGENTS" value={total} color={UI.text.secondary} />
        <Stat label="ACTIVE" value={active} color={STATUS_COLORS.running} />
        <Stat label="DONE" value={completed} color={STATUS_COLORS.completed} />
        <Stat label="ERRORS" value={errors} color={UI.error} />
        <CostProjection />
        <SoundToggle />
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

function SoundToggle() {
  const soundMuted = useAgentStore((s) => s.soundMuted);
  const toggle = useAgentStore((s) => s.toggleSoundMute);

  return (
    <button
      onClick={toggle}
      aria-label={soundMuted ? "Unmute notifications" : "Mute notifications"}
      title={soundMuted ? "Unmute notifications" : "Mute notifications"}
      className="p-1 rounded transition-colors"
      style={{
        color: soundMuted ? UI.text.dimmed : UI.text.secondary,
        background: "transparent",
        border: "none",
      }}
    >
      {soundMuted ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}
