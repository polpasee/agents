"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import { getTokenPercent, formatNumber } from "@/lib/utils";

export function AgentDetail() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  const agent = selectedAgentId ? agents.get(selectedAgentId) : null;

  if (!agent) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center"
        style={{
          width: 300,
          background: "var(--color-panel)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        <span className="text-sm" style={{ color: "#444" }}>
          Select an agent to inspect
        </span>
      </div>
    );
  }

  const color = AGENT_COLORS[agent.agentType];
  const statusColor = STATUS_COLORS[agent.status];
  const totalTokens = agent.inputTokens + agent.outputTokens;
  const tokenPercent = getTokenPercent(agent);

  const elapsed = agent.duration
    ? agent.duration
    : Date.now() - agent.startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  const recentTools = agent.toolCalls.slice(-5).reverse();

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 300,
        background: "var(--color-panel)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2"
        style={{ borderBottom: `1px solid ${color}33` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          />
          <span className="text-sm font-bold" style={{ color }}>
            {AGENT_LABELS[agent.agentType]}
          </span>
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "#555" }}>
          {agent.id}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {/* Status */}
        <DetailRow label="STATUS">
          <div className="flex items-center gap-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
            />
            <span className="capitalize text-sm" style={{ color: statusColor }}>
              {agent.status}
            </span>
          </div>
        </DetailRow>

        {/* Model */}
        {agent.model && (
          <DetailRow label="MODEL">
            <span className="text-sm" style={{ color: "#a78bfa" }}>
              {agent.model}
            </span>
          </DetailRow>
        )}

        {/* Slug */}
        {agent.slug && (
          <DetailRow label="SLUG">
            <span className="text-xs" style={{ color: "#666" }}>
              {agent.slug}
            </span>
          </DetailRow>
        )}

        {/* Task */}
        <DetailRow label="CURRENT TASK">
          <span className="text-sm" style={{ color: "#e2e8f0" }}>
            {agent.task}
          </span>
        </DetailRow>

        {/* Tokens */}
        <DetailRow label="TOKENS">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm" style={{ color: "#00f5ff" }}>
                {formatNumber(totalTokens)}
              </span>
              <span className="text-xs" style={{ color: "#555" }}>
                / {formatNumber(agent.contextWindow)}
              </span>
            </div>
            <div
              className="mt-1 h-1 rounded-full overflow-hidden"
              style={{ background: "var(--color-border)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${tokenPercent}%`,
                  background: `linear-gradient(to right, ${color}, ${color}88)`,
                  boxShadow: `0 0 4px ${color}`,
                }}
              />
            </div>
            <div className="flex gap-3 mt-1.5 text-xs">
              <span style={{ color: "#555" }}>
                in: <span style={{ color: "#94a3b8" }}>{formatNumber(agent.inputTokens)}</span>
              </span>
              <span style={{ color: "#555" }}>
                out: <span style={{ color: "#94a3b8" }}>{formatNumber(agent.outputTokens)}</span>
              </span>
            </div>
            {(agent.cacheReadTokens > 0 || agent.cacheCreateTokens > 0) && (
              <div className="flex gap-3 text-xs">
                <span style={{ color: "#555" }}>
                  cache read: <span style={{ color: "#00ff88" }}>{formatNumber(agent.cacheReadTokens)}</span>
                </span>
                <span style={{ color: "#555" }}>
                  cache write: <span style={{ color: "#ffaa00" }}>{formatNumber(agent.cacheCreateTokens)}</span>
                </span>
              </div>
            )}
          </div>
        </DetailRow>

        {/* Duration */}
        <DetailRow label="DURATION">
          <span className="text-sm" style={{ color: "#94a3b8" }}>
            {minutes}m {seconds}s
          </span>
        </DetailRow>

        {/* Recent Tool Calls */}
        <DetailRow label="RECENT TOOLS">
          <div className="space-y-1">
            {recentTools.length === 0 && (
              <span className="text-xs" style={{ color: "#444" }}>
                No tool calls yet
              </span>
            )}
            {recentTools.map((tc, i) => (
              <div
                key={i}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "#1a1a2e", color: "#ffaa00" }}
              >
                {tc.tool}
                {tc.args && (
                  <span style={{ color: "#555" }}> — {tc.args}</span>
                )}
              </div>
            ))}
          </div>
        </DetailRow>

        {/* Summary (if completed) */}
        {agent.summary && (
          <DetailRow label="SUMMARY">
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              {agent.summary}
            </span>
          </DetailRow>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-xs uppercase tracking-wider mb-0.5"
        style={{ color: "#555" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

