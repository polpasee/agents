"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { resolveSessionId } from "@/lib/sessions";
import { UI } from "@/lib/colors";

export function TopBar() {
  const connected = useAgentStore((s) => s.connected);
  const replayActive = useAgentStore((s) => s.replay.active);
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const selectOnlySession = useAgentStore((s) => s.selectOnlySession);
  const selectAllSessions = useAgentStore((s) => s.selectAllSessions);

  // Dropdown lists main agents (one per session). Picking one filters the
  // topology to that session; picking "All sessions" clears the filter. This is
  // a view filter — it never opens the agent detail panel.
  const sessions = useMemo(() => {
    return Array.from(agents.values())
      .filter((a) => a.agentType === "main")
      .sort((a, b) => b.startTime - a.startTime)
      .map((agent) => ({
        sessionId: resolveSessionId(agent, agents),
        label:
          (agent.metadata?.projectName as string | undefined) ||
          agent.sessionId ||
          agent.id,
      }));
  }, [agents]);

  // Reflect the active filter only when it's a single session — multi-select
  // (driven by the sidebar pills) has no single dropdown value, so fall back to
  // the "All sessions" option rather than show a stale pick.
  const currentValue =
    selectedSessionIds.size === 1 ? [...selectedSessionIds][0] : "";

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

      {/* Right: Session filter */}
      <select
        aria-label="Filter sessions"
        value={currentValue}
        onChange={(e) =>
          e.target.value ? selectOnlySession(e.target.value) : selectAllSessions()
        }
        disabled={sessions.length === 0}
        className="text-xs font-mono rounded px-2 py-1 outline-none max-w-[60vw]"
        style={{
          background: "var(--color-bg)",
          color: UI.text.primary,
          border: `1px solid ${UI.primary}44`,
        }}
      >
        <option value="">
          {sessions.length === 0 ? "No agents" : `All sessions (${sessions.length})`}
        </option>
        {sessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>
            {session.label}
          </option>
        ))}
      </select>
    </div>
  );
}
