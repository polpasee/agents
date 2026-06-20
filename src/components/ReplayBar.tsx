"use client";
import { useAgentStore } from "@/lib/store";
import { formatDuration } from "@/lib/utils";
import { UI } from "@/lib/colors";
import type { ReplaySpeed } from "@/lib/types";

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4];

export function ReplayBar() {
  const replay = useAgentStore((s) => s.replay);
  const replayPlay = useAgentStore((s) => s.replayPlay);
  const replayPause = useAgentStore((s) => s.replayPause);
  const replaySeek = useAgentStore((s) => s.replaySeek);
  const replaySetSpeed = useAgentStore((s) => s.replaySetSpeed);
  const replayExit = useAgentStore((s) => s.replayExit);

  if (!replay.active || !replay.session) return null;

  const totalEvents = replay.session.events.length;
  const elapsed = replay.currentTime - replay.startTime;
  const total = replay.endTime - replay.startTime;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: "var(--color-panel, #0d1117)",
        borderTop: `1px solid ${UI.primary}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        zIndex: 1000,
        fontFamily: "monospace",
        fontSize: 13,
        color: UI.text.primary,
      }}
    >
      {/* Play / Pause */}
      <button
        onClick={replay.playing ? replayPause : replayPlay}
        style={{
          background: "transparent",
          border: `1px solid ${UI.primary}`,
          color: UI.primary,
          cursor: "pointer",
          width: 32,
          height: 32,
          borderRadius: 4,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={replay.playing ? "Pause" : "Play"}
      >
        {replay.playing ? "\u23F8" : "\u25B6"}
      </button>

      {/* Speed selector */}
      <div style={{ display: "flex", gap: 4 }}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => replaySetSpeed(s)}
            style={{
              background: replay.speed === s ? UI.primary : "transparent",
              color: replay.speed === s ? "#000" : UI.text.secondary,
              border: `1px solid ${replay.speed === s ? UI.primary : UI.text.muted}`,
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Progress slider */}
      <input
        type="range"
        min={replay.startTime}
        max={replay.endTime}
        value={replay.currentTime}
        onChange={(e) => replaySeek(Number(e.target.value))}
        style={{
          flex: 1,
          accentColor: UI.primary,
          cursor: "pointer",
        }}
      />

      {/* Time display */}
      <span style={{ color: UI.text.secondary, whiteSpace: "nowrap" }}>
        {formatDuration(elapsed)} / {formatDuration(total)}
      </span>

      {/* Event counter */}
      <span style={{ color: UI.text.muted, whiteSpace: "nowrap" }}>
        Event {replay.currentIndex} / {totalEvents}
      </span>

      {/* Exit button */}
      <button
        onClick={replayExit}
        style={{
          background: "transparent",
          border: `1px solid ${UI.error}`,
          color: UI.error,
          cursor: "pointer",
          width: 32,
          height: 32,
          borderRadius: 4,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title="Exit replay"
      >
        ✕
      </button>
    </div>
  );
}
