"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";

export function TopBar() {
  const connected = useAgentStore((s) => s.connected);
  const replayActive = useAgentStore((s) => s.replay.active);

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

      </div>
    </div>
  );
}
