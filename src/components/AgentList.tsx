"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { STATUS_COLORS, AGENT_LABELS, UI, TEAM_STATUS_COLORS, agentColor } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import type { AgentState, TeamState } from "@/lib/types";
import { UsagePanel } from "./UsagePanel";

function shortModel(model: string): string {
  const m = model.match(/claude-(opus|sonnet|haiku)/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : model;
}

function AgentRow({ agent, isSelected, onClick }: { agent: AgentState; isSelected: boolean; onClick: () => void }) {
  const color = agentColor(agent);
  const isRunning = agent.status === "running";
  const lastTool = agent.toolCalls.length > 0 ? agent.toolCalls[agent.toolCalls.length - 1].tool : null;
  const statusLabel = isRunning && lastTool
    ? lastTool
    : agent.status === "idle" ? "thinking" : agent.status;
  const statusColor = STATUS_COLORS[agent.status];
  return (
    <button
      onClick={onClick}
      aria-selected={isSelected}
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
          {(agent.displayType || AGENT_LABELS[agent.agentType]).toUpperCase()}{agent.model ? `(${shortModel(agent.model)})` : ""}
        </span>
        <span className="text-xs capitalize truncate ml-auto flex-shrink-0" style={{ color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="text-xs truncate mt-0.5 ml-3" style={{ color: UI.text.dimmed }}>
        {agent.task}
      </div>
    </button>
  );
}

interface SessionGroup {
  sessionId: string;
  label: string;
  agents: AgentState[];
}

function SessionAgents({
  agents,
  teams,
  selectedAgentId,
  selectAgent,
  selectedTeamId,
  selectTeam,
}: {
  agents: AgentState[];
  teams: Map<string, TeamState>;
  selectedAgentId: string | null;
  selectAgent: (id: string) => void;
  selectedTeamId: string | null;
  selectTeam: (id: string | null) => void;
}) {
  const { teamGroups, soloAgents } = useMemo(() => {
    const teamGroups = new Map<string, { team: TeamState; members: AgentState[] }>();
    const soloAgents: AgentState[] = [];

    for (const agent of agents) {
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
  }, [agents, teams]);

  return (
    <>
      {Array.from(teamGroups.values()).map(({ team, members }) => {
        const isTeamSelected = team.id === selectedTeamId;
        const statusColor = TEAM_STATUS_COLORS[team.status] || UI.text.muted;
        return (
          <div key={team.id} className="space-y-0.5">
            <button
              onClick={() => selectTeam(isTeamSelected ? null : team.id)}
              aria-expanded={isTeamSelected}
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

      {soloAgents.map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          isSelected={agent.id === selectedAgentId}
          onClick={() => selectAgent(agent.id)}
        />
      ))}
    </>
  );
}

export function AgentList() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const teams = useAgentStore((s) => s.teams);
  const selectedTeamId = useAgentStore((s) => s.selectedTeamId);
  const selectTeam = useAgentStore((s) => s.selectTeam);
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const toggleSession = useAgentStore((s) => s.toggleSession);

  const agentList = useFilteredAgents();

  // Build session groups from ALL agents (not filtered) so we always show all sessions in the sidebar
  const allSessionGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup>();
    const allAgents = Array.from(agents.values());

    for (const agent of allAgents) {
      let sessionId: string;
      let label: string;

      if (agent.parentId) {
        const parent = agents.get(agent.parentId);
        sessionId = parent?.sessionId || parent?.id || agent.sessionId || agent.id;
        label = (parent?.metadata?.projectName as string) || sessionId;
      } else {
        sessionId = agent.sessionId || agent.id;
        label = (agent.metadata?.projectName as string) || sessionId;
      }

      const group = groups.get(sessionId);
      if (group) {
        group.agents.push(agent);
      } else {
        groups.set(sessionId, { sessionId, label, agents: [agent] });
      }
    }

    // Disambiguate label collisions: when two Claude sessions live in the same
    // project, append a short session-id suffix so users can tell them apart.
    const labelCounts = new Map<string, number>();
    for (const g of groups.values()) labelCounts.set(g.label, (labelCounts.get(g.label) ?? 0) + 1);
    for (const g of groups.values()) {
      if ((labelCounts.get(g.label) ?? 0) > 1) {
        g.label = `${g.label} · ${g.sessionId.slice(0, 6)}`;
      }
    }

    return Array.from(groups.values());
  }, [agents]);

  // Filtered agents grouped by session (for rendering agent rows)
  const filteredSessionGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup>();

    for (const agent of agentList) {
      let sessionId: string;
      let label: string;

      if (agent.parentId) {
        const parent = agents.get(agent.parentId);
        sessionId = parent?.sessionId || parent?.id || agent.sessionId || agent.id;
        label = (parent?.metadata?.projectName as string) || sessionId;
      } else {
        sessionId = agent.sessionId || agent.id;
        label = (agent.metadata?.projectName as string) || sessionId;
      }

      const group = groups.get(sessionId);
      if (group) {
        group.agents.push(agent);
      } else {
        groups.set(sessionId, { sessionId, label, agents: [agent] });
      }
    }

    return groups;
  }, [agentList, agents]);

  const sessionCount = allSessionGroups.length;
  const hasMultipleSessions = sessionCount > 1;

  return (
    <div
      role="region"
      aria-label="Agent list"
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
        {hasMultipleSessions && (
          <span style={{ color: UI.text.dimmed }}> &middot; {sessionCount} sessions</span>
        )}
        {teams.size > 0 && (
          <span style={{ color: UI.text.dimmed }}> &middot; {teams.size} team{teams.size !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {agentList.length === 0 && selectedSessionIds.size === 0 && (
          <div className="text-sm text-center py-8" style={{ color: UI.text.empty }}>
            No agents connected
          </div>
        )}

        {hasMultipleSessions
          ? allSessionGroups.map((group) => {
              const isSelected = selectedSessionIds.has(group.sessionId);
              const isActive = selectedSessionIds.size === 0 || isSelected;
              const filtered = filteredSessionGroups.get(group.sessionId);
              return (
                <div key={group.sessionId} className="space-y-0.5">
                  <button
                    onClick={() => toggleSession(group.sessionId)}
                    aria-pressed={isSelected}
                    className="w-full text-left rounded-md px-2 py-1.5 transition-colors"
                    style={{
                      background: isSelected ? `${UI.primary}18` : `${UI.primary}08`,
                      border: `1px solid ${isSelected ? UI.primary : `${UI.primary}20`}`,
                      opacity: isActive ? 1 : 0.4,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-medium truncate"
                        style={{ color: isSelected ? UI.primary : UI.text.secondary }}
                        title={group.label}
                      >
                        {group.label}
                      </span>
                      <span className="text-xs ml-auto flex-shrink-0" style={{ color: UI.text.dimmed }}>
                        {group.agents.length}
                      </span>
                    </div>
                  </button>
                  {isActive && filtered && (
                    <div className="ml-2 space-y-0.5">
                      <SessionAgents
                        agents={filtered.agents}
                        teams={teams}
                        selectedAgentId={selectedAgentId}
                        selectAgent={selectAgent}
                        selectedTeamId={selectedTeamId}
                        selectTeam={selectTeam}
                      />
                    </div>
                  )}
                </div>
              );
            })
          : allSessionGroups.length === 1 && filteredSessionGroups.size === 1
            ? (
              <SessionAgents
                agents={agentList}
                teams={teams}
                selectedAgentId={selectedAgentId}
                selectAgent={selectAgent}
                selectedTeamId={selectedTeamId}
                selectTeam={selectTeam}
              />
            )
            : null}
      </div>
      <UsagePanel />
    </div>
  );
}
