"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";

export function AgentList() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const allAgents = Array.from(agents.values());
  const agentList = selectedSessionId
    ? allAgents.filter((a) => {
        const mainAgent = a.parentId ? agents.get(a.parentId) : a;
        const sid = mainAgent?.sessionId || mainAgent?.id;
        return sid === selectedSessionId;
      })
    : allAgents;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 200,
        background: "#0d1117",
        borderRight: "1px solid #1a1a2e",
      }}
    >
      <div
        className="px-3 py-2 text-[10px] uppercase tracking-wider"
        style={{ color: "#666", borderBottom: "1px solid #1a1a2e" }}
      >
        Agents ({agentList.length})
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {agentList.length === 0 && (
          <div className="text-[11px] text-center py-8" style={{ color: "#444" }}>
            No agents connected
          </div>
        )}
        {agentList.map((agent) => {
          const color = AGENT_COLORS[agent.agentType];
          const statusColor = STATUS_COLORS[agent.status];
          const isSelected = agent.id === selectedAgentId;

          return (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent.id)}
              className="w-full text-left rounded-md px-2 py-1.5 transition-colors animate-fade-in-up"
              style={{
                background: isSelected ? `${color}11` : "transparent",
                border: `1px solid ${isSelected ? `${color}44` : "#1a1a2e"}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: color, boxShadow: `0 0 4px ${color}` }}
                />
                <span className="text-[11px] truncate" style={{ color: isSelected ? color : "#94a3b8" }}>
                  {AGENT_LABELS[agent.agentType]}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5 ml-3">
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ background: statusColor }}
                />
                <span className="text-[9px] capitalize" style={{ color: statusColor }}>
                  {agent.status}
                </span>
              </div>
              <div
                className="text-[9px] truncate mt-0.5 ml-3"
                style={{ color: "#555" }}
              >
                {agent.task}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
