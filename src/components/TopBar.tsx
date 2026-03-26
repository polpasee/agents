"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { calculateTotalCost, formatCost } from "@/lib/costs";

export function TopBar() {
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);
  const selectSession = useAgentStore((s) => s.selectSession);

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
          {!connected && (
            <span className="text-xs text-red-400 ml-2">
              DISCONNECTED
            </span>
          )}
        </div>

        {/* Session dropdown */}
        {sessions.length > 0 && (
          <select
            value={selectedSessionId || "__all__"}
            onChange={(e) =>
              selectSession(e.target.value === "__all__" ? null : e.target.value)
            }
            className="text-sm rounded px-2 py-1 outline-none cursor-pointer"
            style={{
              background: "var(--color-border)",
              color: UI.text.secondary,
              border: `1px solid ${UI.primary}33`,
              maxWidth: 280,
            }}
          >
            <option value="__all__">All Sessions ({sessions.length})</option>
            {sessions.map((s) => {
              const label = s.projectName
                .split("/")
                .filter(Boolean)
                .slice(-2)
                .join("/");
              return (
                <option key={s.sessionId} value={s.sessionId}>
                  {label} — {s.task.slice(0, 40)}
                </option>
              );
            })}
          </select>
        )}
      </div>

      {/* Right: Stats */}
      <div className="flex gap-6 text-sm">
        <Stat label="AGENTS" value={total} color={UI.text.secondary} />
        <Stat label="ACTIVE" value={active} color="#00ff88" />
        <Stat label="DONE" value={completed} color="#6b7280" />
        <Stat label="ERRORS" value={errors} color={UI.error} />
        <Stat label="COST" value={formatCost(totalCost.total)} color={UI.primary} />
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
