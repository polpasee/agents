"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import { useFilteredAgents } from "@/hooks/useFilteredAgents";

export function AgentList() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const agentList = useFilteredAgents();

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
        style={{ color: "#666", borderBottom: "1px solid var(--color-border)" }}
      >
        Agents ({agentList.length})
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {agentList.length === 0 && (
          <div className="text-sm text-center py-8" style={{ color: "#444" }}>
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
                border: `1px solid ${isSelected ? `${color}44` : "var(--color-border)"}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: color, boxShadow: `0 0 4px ${color}` }}
                />
                <span className="text-sm truncate" style={{ color: isSelected ? color : "#94a3b8" }}>
                  {AGENT_LABELS[agent.agentType]}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5 ml-3">
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ background: statusColor }}
                />
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {agent.status}
                </span>
              </div>
              <div
                className="text-xs truncate mt-0.5 ml-3"
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
