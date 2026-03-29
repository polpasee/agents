"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import type { AgentState, TeamState } from "@/lib/types";

const TEAM_STATUS_COLORS: Record<string, string> = {
  forming: "#eab308",
  active: "#00ff88",
  completed: "#6b7280",
  error: "#ff4444",
};

function AgentRow({ agent, isSelected, onClick }: { agent: AgentState; isSelected: boolean; onClick: () => void }) {
  const color = AGENT_COLORS[agent.agentType];
  const statusColor = STATUS_COLORS[agent.status];
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md px-2 py-1.5 transition-colors animate-fade-in-up"
      style={{
        background: isSelected ? `${color}11` : "transparent",
        border: `1px solid ${isSelected ? `${color}44` : "var(--color-border)"}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: color, boxShadow: `0 0 4px ${color}` }}
        />
        <span className="text-sm truncate" style={{ color: isSelected ? color : UI.text.secondary }}>
          {AGENT_LABELS[agent.agentType]}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-0.5 ml-3">
        <div className="w-1 h-1 rounded-full" style={{ background: statusColor }} />
        <span className="text-xs capitalize" style={{ color: statusColor }}>{agent.status}</span>
      </div>
      <div className="text-xs truncate mt-0.5 ml-3" style={{ color: UI.text.dimmed }}>
        {agent.task}
      </div>
    </button>
  );
}

export function AgentList() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const teams = useAgentStore((s) => s.teams);
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const selectTeam = useAgentStore((s) => s.selectTeam);

  const agentList = useFilteredAgents();

  // Group agents: team members grouped under their team, solo agents listed separately
  const { teamGroups, soloAgents } = useMemo(() => {
    const teamGroups = new Map<string, { team: TeamState; members: AgentState[] }>();
    const soloAgents: AgentState[] = [];

    for (const agent of agentList) {
      if (agent.teamId && teams.has(agent.teamId)) {
        const group = teamGroups.get(agent.teamId);
        if (group) {
          group.members.push(agent);
        } else {
          teamGroups.set(agent.teamId, {
            team: teams.get(agent.teamId)!,
            members: [agent],
          });
        }
      } else {
        soloAgents.push(agent);
      }
    }
    return { teamGroups, soloAgents };
  }, [agentList, teams]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 240,
        background: "var(--color-panel)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      <div
        className="px-3 py-2 text-xs uppercase tracking-wider"
        style={{ color: UI.text.muted, borderBottom: "1px solid var(--color-border)" }}
      >
        Agents ({agentList.length})
        {teams.size > 0 && (
          <span style={{ color: UI.text.dimmed }}> &middot; {teams.size} team{teams.size !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {agentList.length === 0 && (
          <div className="text-sm text-center py-8" style={{ color: UI.text.empty }}>
            No agents connected
          </div>
        )}

        {/* Team groups */}
        {Array.from(teamGroups.values()).map(({ team, members }) => {
          const isTeamSelected = team.id === selectedTeamId;
          const statusColor = TEAM_STATUS_COLORS[team.status] || UI.text.muted;
          return (
            <div key={team.id} className="space-y-0.5">
              <button
                onClick={() => selectTeam(isTeamSelected ? null : team.id)}
                className="w-full text-left rounded-md px-2 py-1.5 transition-colors"
                style={{
                  background: isTeamSelected ? `${UI.primary}11` : `${UI.primary}06`,
                  border: `1px solid ${isTeamSelected ? `${UI.primary}44` : `${UI.primary}15`}`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs" style={{ color: UI.text.dimmed }}>
                    {isTeamSelected ? "▼" : "▶"}
                  </span>
                  <span className="text-xs font-bold font-mono" style={{ color: UI.primary }}>
                    TEAM
                  </span>
                  <span className="text-xs truncate" style={{ color: UI.text.secondary }}>
                    {team.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 ml-4">
                  <div className="w-1 h-1 rounded-full" style={{ background: statusColor }} />
                  <span className="text-xs capitalize" style={{ color: statusColor }}>{team.status}</span>
                  <span className="text-xs ml-1" style={{ color: UI.text.dimmed }}>
                    ({members.length} members)
                  </span>
                </div>
              </button>
              {isTeamSelected && (
                <div className="ml-3 space-y-0.5">
                  {members.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      isSelected={agent.id === selectedAgentId}
                      onClick={() => selectAgent(agent.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Solo agents (not in any team) */}
        {soloAgents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isSelected={agent.id === selectedAgentId}
            onClick={() => selectAgent(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
