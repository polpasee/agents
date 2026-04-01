"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI, TEAM_STATUS_COLORS } from "@/lib/colors";
import { formatNumber, formatDuration } from "@/lib/utils";
import { calculateCost, formatCost } from "@/lib/costs";

export function TeamPanel() {
  const teams = useAgentStore((s) => s.teams);
  const agents = useAgentStore((s) => s.agents);
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const selectTeam = useAgentStore((s) => s.selectTeam);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  if (teams.size === 0) return null;

  const teamList = Array.from(teams.values());

  return (
    <div
      role="region"
      aria-label="Team overview"
      className="flex flex-col"
      style={{
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        className="px-3 py-1.5 text-xs uppercase tracking-wider flex-shrink-0 flex items-center justify-between"
        style={{ color: UI.text.muted, borderBottom: "1px solid var(--color-border)" }}
      >
        <span>Teams ({teamList.length})</span>
      </div>
      <div className="overflow-y-auto custom-scrollbar p-2 space-y-2" style={{ maxHeight: 300 }}>
        {teamList.map((team) => {
          const isSelected = team.id === selectedTeamId;
          const statusColor = TEAM_STATUS_COLORS[team.status];
          const members = team.memberIds
            .map((id) => agents.get(id))
            .filter(Boolean);
          const leader = team.leaderId ? agents.get(team.leaderId) : null;

          let totalTokens = 0;
          let totalCostValue = 0;
          let completedCount = 0;
          let errorCount = 0;
          let activeCount = 0;
          for (const m of members) {
            if (!m) continue;
            totalTokens += m.inputTokens + m.outputTokens;
            totalCostValue += calculateCost(m).total;
            if (m.status === "completed") completedCount++;
            else if (m.status === "error") errorCount++;
            else if (m.status === "running" || m.status === "idle") activeCount++;
          }

          const elapsed = Date.now() - team.startTime;

          return (
            <div
              key={team.id}
              className="rounded-md p-2 cursor-pointer transition-colors"
              onClick={() => selectTeam(isSelected ? null : team.id)}
              style={{
                background: isSelected ? `${UI.primary}11` : "transparent",
                border: `1px solid ${isSelected ? `${UI.primary}44` : "var(--color-border)"}`,
              }}
            >
              {/* Team header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
                  />
                  <span className="text-sm font-bold font-mono" style={{ color: UI.primary }}>
                    {team.name}
                  </span>
                </div>
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {team.status}
                </span>
              </div>

              {/* Task */}
              <div className="text-xs mt-1 truncate" style={{ color: UI.text.muted }}>
                {team.task}
              </div>

              {/* Stats row */}
              <div className="flex gap-3 mt-1.5 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  Members: <span style={{ color: UI.text.secondary }}>{members.length}</span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  Active: <span style={{ color: STATUS_COLORS.running }}>{activeCount}</span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  Done: <span style={{ color: STATUS_COLORS.completed }}>{completedCount}</span>
                </span>
                {errorCount > 0 && (
                  <span style={{ color: UI.text.dimmed }}>
                    Errors: <span style={{ color: UI.error }}>{errorCount}</span>
                  </span>
                )}
              </div>

              {/* Tokens + Cost + Duration */}
              <div className="flex gap-3 mt-1 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  Tokens: <span style={{ color: UI.primary }}>{formatNumber(totalTokens)}</span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  Cost: <span style={{ color: UI.primary }}>{formatCost(totalCostValue)}</span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  Time: <span style={{ color: UI.text.secondary }}>{formatDuration(elapsed)}</span>
                </span>
              </div>

              {/* Member list (expanded when selected) */}
              {isSelected && (
                <div className="mt-2 space-y-1">
                  {leader && (
                    <div className="flex items-center gap-1 text-xs">
                      <span style={{ color: UI.text.dimmed }}>Lead:</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); selectAgent(leader.id); }}
                        className="hover:underline"
                        style={{ color: AGENT_COLORS[leader.agentType] }}
                      >
                        {AGENT_LABELS[leader.agentType]}:{leader.id.slice(0, 8)}
                      </button>
                    </div>
                  )}
                  {members.map((m) => {
                    if (!m || m.id === team.leaderId) return null;
                    const color = AGENT_COLORS[m.agentType];
                    return (
                      <div key={m.id} className="flex items-center gap-1.5 text-xs">
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: color }}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); selectAgent(m.id); }}
                          className="hover:underline truncate"
                          style={{ color }}
                        >
                          {AGENT_LABELS[m.agentType]}:{m.id.slice(0, 8)}
                        </button>
                        <span className="capitalize" style={{ color: STATUS_COLORS[m.status] }}>
                          {m.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
