"use client";

import { useAgentStore } from "@/lib/store";

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

  // Filter agents by selected session
  const filteredAgents = selectedSessionId
    ? allAgents.filter((a) => {
        const mainAgent = a.parentId ? agents.get(a.parentId) : a;
        const sid = mainAgent?.sessionId || mainAgent?.id;
        return sid === selectedSessionId;
      })
    : allAgents;

  const total = filteredAgents.length;
  const active = filteredAgents.filter(
    (a) => a.status === "running" || a.status === "waiting"
  ).length;
  const completed = filteredAgents.filter((a) => a.status === "completed").length;
  const errors = filteredAgents.filter((a) => a.status === "error").length;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b"
      style={{
        background: "#0d1117",
        borderColor: "#00f5ff33",
      }}
    >
      {/* Left: Title + Session Selector */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: connected ? "#00f5ff" : "#ff4444",
              boxShadow: connected
                ? "0 0 8px #00f5ff, 0 0 16px #00f5ff66"
                : "0 0 8px #ff4444",
            }}
          />
          <span
            className="text-sm font-bold tracking-widest"
            style={{ color: "#00f5ff", textShadow: "0 0 8px #00f5ff66" }}
          >
            AGENT MONITOR
          </span>
          {!connected && (
            <span className="text-[10px] text-red-400 ml-2">
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
            className="text-[11px] rounded px-2 py-1 outline-none cursor-pointer"
            style={{
              background: "#1a1a2e",
              color: "#94a3b8",
              border: "1px solid #00f5ff33",
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
      <div className="flex gap-6 text-xs">
        <Stat label="AGENTS" value={total} color="#94a3b8" />
        <Stat label="ACTIVE" value={active} color="#00ff88" />
        <Stat label="DONE" value={completed} color="#6b7280" />
        <Stat label="ERRORS" value={errors} color="#ff4444" />
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
  value: number;
  color: string;
}) {
  return (
    <span style={{ color: "#666" }}>
      {label}:{" "}
      <span style={{ color, textShadow: `0 0 6px ${color}66` }}>{value}</span>
    </span>
  );
}
