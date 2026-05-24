"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";

export function TopBar() {
  const connected = useAgentStore((s) => s.connected);
  const replayActive = useAgentStore((s) => s.replay.active);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  // Dropdown lists main agents (one per session). Sub-agents/tool nodes are
  // navigated by clicking in the topology — the dropdown is for jumping
  // between top-level sessions, especially useful on mobile.
  const mainAgents = useMemo(() => {
    return Array.from(agents.values())
      .filter((a) => a.agentType === "main")
      .sort((a, b) => b.startTime - a.startTime);
  }, [agents]);

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

      {/* Right: Agent selector */}
      <select
        aria-label="Select agent"
        value={selectedAgentId ?? ""}
        onChange={(e) => selectAgent(e.target.value || null)}
        disabled={mainAgents.length === 0}
        className="text-xs font-mono rounded px-2 py-1 outline-none max-w-[60vw]"
        style={{
          background: "var(--color-bg)",
          color: UI.text.primary,
          border: `1px solid ${UI.primary}44`,
        }}
      >
        <option value="">
          {mainAgents.length === 0 ? "No agents" : `All sessions (${mainAgents.length})`}
        </option>
        {mainAgents.map((agent) => {
          const projectName = agent.metadata?.projectName as string | undefined;
          const label = projectName || agent.sessionId || agent.id;
          return (
            <option key={agent.id} value={agent.id}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}
