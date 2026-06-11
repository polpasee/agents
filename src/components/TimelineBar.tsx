"use client";

import { useRef, useEffect, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, UI } from "@/lib/colors";
import { calculateTotalCost, formatCost } from "@/lib/costs";
import { earliestStartTime, formatDuration } from "@/lib/utils";

export function TimelineBar() {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);
  const trackRef = useRef<HTMLDivElement>(null);

  const [reviewMode, setReviewMode] = useState(false);
  const replaySetSpeed = useAgentStore((s) => s.replaySetSpeed);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [scrubPosition, setScrubPosition] = useState(100); // percentage
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (trackRef.current && !isDragging && !reviewMode) {
      trackRef.current.scrollLeft = trackRef.current.scrollWidth;
    }
  }, [activity, isDragging, reviewMode]);

  const totalCost = calculateTotalCost(agents);
  const activeCount = Array.from(agents.values()).filter(
    (a) => a.status === "running" || a.status === "idle"
  ).length;

  const now = Date.now();
  const earliest = earliestStartTime(agents.values(), now);
  const elapsed = now - earliest;

  const dots = activity
    .filter((e) => e.event.type !== "agent:tokens")
    .map((entry) => {
      const pct = elapsed > 0 ? ((entry.timestamp - earliest) / elapsed) * 100 : 50;
      let color: string = UI.text.muted;

      switch (entry.event.type) {
        case "agent:register":
          color = UI.primary;
          break;
        case "agent:tool_call":
          { const aid = entry.event.agentId;
          const a = agents.get(aid);
          color = a ? AGENT_COLORS[a.agentType] : UI.text.muted; }
          break;
        case "agent:complete":
          color = UI.success;
          break;
        case "agent:status":
          color = entry.event.status === "error" ? UI.error : UI.text.dimmed;
          break;
      }

      return { id: entry.id, pct: Math.max(0, Math.min(100, pct)), color };
    });

  // Visible dots based on scrub position in review mode
  const visibleDots = reviewMode
    ? dots.filter((d) => d.pct <= scrubPosition)
    : dots;

  const speeds: import("@/lib/types").ReplaySpeed[] = [0.5, 1, 2, 4];

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!reviewMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setScrubPosition(Math.max(0, Math.min(100, pct)));
  }

  function handleTrackDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDragging || !reviewMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setScrubPosition(Math.max(0, Math.min(100, pct)));
  }

  return (
    <div
      className="flex items-center gap-3 px-4"
      style={{
        height: 48,
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {/* LIVE / Review indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {!reviewMode ? (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: connected ? UI.success : UI.error,
                boxShadow: `0 0 6px ${connected ? UI.success : UI.error}`,
                animation: connected ? "pulse-glow 1.5s ease-in-out infinite" : "none",
              }}
            />
            <span
              className="text-xs font-mono font-bold tracking-wider"
              style={{ color: connected ? UI.success : UI.error }}
            >
              LIVE
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setReviewMode(false); setScrubPosition(100); }}
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ color: UI.primary, border: `1px solid ${UI.primary}44` }}
              aria-label="Resume live mode"
            >
              LIVE
            </button>
          </div>
        )}
        <span className="text-xs font-mono" style={{ color: UI.text.dimmed }}>
          {formatDuration(elapsed)}
        </span>
      </div>

      {/* Event track / Scrubber */}
      <div
        ref={trackRef}
        className="flex-1 relative cursor-pointer"
        style={{ height: 20 }}
        onClick={handleTrackClick}
        onMouseDown={() => reviewMode && setIsDragging(true)}
        onMouseMove={handleTrackDrag}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "var(--color-border)" }}
        />
        {/* Progress fill in review mode */}
        {reviewMode && (
          <div
            className="absolute top-0 bottom-0 left-0 rounded-full"
            style={{
              width: `${scrubPosition}%`,
              background: `${UI.primary}15`,
            }}
          />
        )}
        {visibleDots.map((dot) => (
          <div
            key={dot.id}
            className="absolute top-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${dot.pct}%`,
              width: 4,
              height: 4,
              background: dot.color,
              boxShadow: `0 0 4px ${dot.color}`,
            }}
          />
        ))}
        {/* Scrub playhead */}
        {reviewMode && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${scrubPosition}%`,
              width: 2,
              background: UI.primary,
              boxShadow: `0 0 6px ${UI.primary}`,
              borderRadius: 1,
            }}
          />
        )}
      </div>

      {/* Speed controls (review mode only) */}
      {reviewMode && (
        <div className="flex gap-0.5 flex-shrink-0">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => { setPlaybackSpeed(s); replaySetSpeed(s); }}
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: playbackSpeed === s ? `${UI.primary}22` : "transparent",
                border: `1px solid ${playbackSpeed === s ? UI.primary : "var(--color-border)"}`,
                color: playbackSpeed === s ? UI.primary : UI.text.muted,
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      )}

      {/* Right section */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {!reviewMode && (
          <button
            onClick={() => setReviewMode(true)}
            className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ color: UI.text.muted, border: "1px solid var(--color-border)" }}
          >
            Review
          </button>
        )}
        <span className="text-xs font-mono" style={{ color: UI.text.dimmed }}>
          {activeCount} active
        </span>
        <span className="text-xs font-mono font-bold" style={{ color: UI.primary }}>
          {formatCost(totalCost.total)}
        </span>
      </div>
    </div>
  );
}
