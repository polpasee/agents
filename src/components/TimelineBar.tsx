"use client";

import { useRef, useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, UI } from "@/lib/colors";
import { calculateTotalCost, formatCost } from "@/lib/costs";
import { formatDuration } from "@/lib/utils";

export function TimelineBar() {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);
  const trackRef = useRef<HTMLDivElement>(null);

  // Auto-scroll track to the right
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.scrollLeft = trackRef.current.scrollWidth;
    }
  }, [activity]);

  const totalCost = calculateTotalCost(agents);
  const activeCount = Array.from(agents.values()).filter(
    (a) => a.status === "running" || a.status === "idle"
  ).length;

  // Calculate time range
  const agentList = Array.from(agents.values());
  const earliest = agentList.length > 0
    ? Math.min(...agentList.map((a) => a.startTime))
    : Date.now();
  const now = Date.now();
  const elapsed = now - earliest;

  // Map activity events to positioned dots
  const dots = activity
    .filter((e) => e.event.type !== "agent:tokens") // skip noisy token events
    .map((entry) => {
      const pct = elapsed > 0 ? ((entry.timestamp - earliest) / elapsed) * 100 : 50;
      let color: string = UI.text.muted;
      let agentId = "";

      switch (entry.event.type) {
        case "agent:register":
          color = UI.primary;
          agentId = entry.event.agentId;
          break;
        case "agent:tool_call":
          agentId = entry.event.agentId;
          color = agents.get(agentId)
            ? AGENT_COLORS[agents.get(agentId)!.agentType]
            : UI.text.muted;
          break;
        case "agent:complete":
          color = UI.text.secondary;
          agentId = entry.event.agentId;
          break;
        case "agent:status":
          if (entry.event.status === "error") color = UI.error;
          else color = UI.text.dimmed;
          agentId = entry.event.agentId;
          break;
      }

      return { id: entry.id, pct: Math.max(0, Math.min(100, pct)), color };
    });

  return (
    <div
      className="flex items-center gap-4 px-4"
      style={{
        height: 48,
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {/* LIVE indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: connected ? "#00ff88" : UI.error,
              boxShadow: connected ? "0 0 6px #00ff88" : `0 0 6px ${UI.error}`,
              animation: connected ? "pulse-glow 1.5s ease-in-out infinite" : "none",
            }}
          />
          <span
            className="text-xs font-mono font-bold tracking-wider"
            style={{ color: connected ? "#00ff88" : UI.error }}
          >
            LIVE
          </span>
        </div>
        <span className="text-xs font-mono" style={{ color: UI.text.dimmed }}>
          {formatDuration(elapsed)}
        </span>
      </div>

      {/* Event track */}
      <div
        ref={trackRef}
        className="flex-1 relative overflow-hidden"
        style={{ height: 20 }}
      >
        {/* Track background */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "var(--color-border)" }}
        />
        {/* Event dots */}
        {dots.map((dot) => (
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
      </div>

      {/* Right stats */}
      <div className="flex items-center gap-3 flex-shrink-0">
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
