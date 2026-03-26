"use client";

import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { useAgentStore } from "@/lib/store";
import { formatDuration, truncateId } from "@/lib/utils";

export function Timeline() {
  const agents = useFilteredAgents();
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: UI.text.empty }}>
        No agents to display
      </div>
    );
  }

  const now = Date.now();
  const earliest = Math.min(...agents.map((a) => a.startTime));
  const totalRange = now - earliest || 1;

  const sorted = [...agents].sort((a, b) => {
    const aActive = a.status === "running" || a.status === "idle" ? 0 : 1;
    const bActive = b.status === "running" || b.status === "idle" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.startTime - b.startTime;
  });

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4" style={{ background: "var(--color-bg)" }}>
      {sorted.map((agent) => {
        const color = AGENT_COLORS[agent.agentType];
        const statusColor = STATUS_COLORS[agent.status];
        const startPct = ((agent.startTime - earliest) / totalRange) * 100;
        const endTime = agent.duration ? agent.startTime + agent.duration : now;
        const widthPct = Math.max(((endTime - agent.startTime) / totalRange) * 100, 1);
        const isSelected = agent.id === selectedAgentId;
        const elapsed = agent.duration || now - agent.startTime;

        return (
          <div
            key={agent.id}
            className="flex items-center gap-3 py-1 cursor-pointer"
            onClick={() => selectAgent(agent.id)}
            style={{ opacity: isSelected ? 1 : 0.8 }}
          >
            <div className="flex-shrink-0" style={{ width: 120 }}>
              <span className="text-xs font-mono font-bold" style={{ color }}>
                {AGENT_LABELS[agent.agentType]}
              </span>
              <span className="text-xs ml-1" style={{ color: UI.text.dimmed }}>
                {truncateId(agent.id)}
              </span>
            </div>

            <div className="flex-1 relative" style={{ height: 20 }}>
              <div
                className="absolute inset-0 rounded-sm"
                style={{ background: "var(--color-border)" }}
              />
              <div
                className="absolute top-0 bottom-0 rounded-sm"
                style={{
                  left: `${startPct}%`,
                  width: `${widthPct}%`,
                  background: `${color}44`,
                  border: `1px solid ${isSelected ? color : `${color}66`}`,
                  boxShadow: isSelected ? `0 0 6px ${color}66` : "none",
                }}
              >
                {agent.toolCalls.map((tc, i) => {
                  const tickPct = ((tc.timestamp - agent.startTime) / (endTime - agent.startTime)) * 100;
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${Math.min(tickPct, 100)}%`,
                        width: 1,
                        background: color,
                        opacity: 0.5,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex-shrink-0 text-right" style={{ width: 80 }}>
              <div className="text-xs font-mono" style={{ color: UI.text.secondary }}>
                {formatDuration(elapsed)}
              </div>
              <div className="flex items-center justify-end gap-1">
                <div className="w-1 h-1 rounded-full" style={{ background: statusColor }} />
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {agent.status}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
