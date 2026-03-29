"use client";

import { useState, useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { getTokenPercent, formatNumber, formatDuration } from "@/lib/utils";
import { calculateCost, formatCost } from "@/lib/costs";

export function AgentDetail() {
  const agents = useAgentStore((s) => s.agents);
  const teams = useAgentStore((s) => s.teams);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agent = selectedAgentId ? agents.get(selectedAgentId) : null;

  // Live timer for running agents — force re-render every second
  const [, tick] = useState(0);
  const isRunning = agent && agent.status !== "completed" && agent.status !== "error";
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (!agent) {
    return (
      <div
        role="complementary"
        aria-label="Agent details"
        className="flex flex-col h-full items-center justify-center"
        style={{
          width: 300,
          background: "var(--color-panel)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        <span className="text-sm" style={{ color: UI.text.empty }}>
          Select an agent to inspect
        </span>
      </div>
    );
  }

  const color = AGENT_COLORS[agent.agentType];
  const statusColor = STATUS_COLORS[agent.status];
  const totalTokens = agent.inputTokens + agent.outputTokens;
  const tokenPercent = getTokenPercent(agent);
  const elapsed = agent.duration ?? (Date.now() - agent.startTime);

  const recentTools = agent.toolCalls.slice(-5).reverse();

  return (
    <div
      role="complementary"
      aria-label="Agent details"
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
        <div className="text-xs mt-0.5 truncate" style={{ color: UI.text.dimmed }}>
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
            <span className="text-sm" style={{ color: UI.model }}>
              {agent.model}
            </span>
          </DetailRow>
        )}

        {/* Slug */}
        {agent.slug && (
          <DetailRow label="SLUG">
            <span className="text-xs" style={{ color: UI.text.muted }}>
              {agent.slug}
            </span>
          </DetailRow>
        )}

        {/* Team */}
        {agent.teamId && teams.has(agent.teamId) && (
          <DetailRow label="TEAM">
            <div className="flex items-center gap-1">
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: UI.primary, background: `${UI.primary}15` }}
              >
                {teams.get(agent.teamId)!.name}
              </span>
              <span className="text-xs" style={{ color: UI.text.dimmed }}>
                ({teams.get(agent.teamId)!.memberIds.length} members)
              </span>
            </div>
          </DetailRow>
        )}

        {/* Task */}
        <DetailRow label="CURRENT TASK">
          <span className="text-sm" style={{ color: UI.text.primary }}>
            {agent.task}
          </span>
        </DetailRow>

        {/* Tokens */}
        <DetailRow label="TOKENS">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm" style={{ color: UI.primary }}>
                {formatNumber(totalTokens)}
              </span>
              <span className="text-xs" style={{ color: UI.text.dimmed }}>
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
              <span style={{ color: UI.text.dimmed }}>
                in: <span style={{ color: UI.text.secondary }}>{formatNumber(agent.inputTokens)}</span>
              </span>
              <span style={{ color: UI.text.dimmed }}>
                out: <span style={{ color: UI.text.secondary }}>{formatNumber(agent.outputTokens)}</span>
              </span>
            </div>
            {(agent.cacheReadTokens > 0 || agent.cacheCreateTokens > 0) && (
              <div className="flex gap-3 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  cache read: <span style={{ color: UI.cache.read }}>{formatNumber(agent.cacheReadTokens)}</span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  cache write: <span style={{ color: UI.cache.write }}>{formatNumber(agent.cacheCreateTokens)}</span>
                </span>
              </div>
            )}
          </div>
        </DetailRow>

        {/* Duration */}
        <DetailRow label="DURATION">
          <span className="text-sm" style={{ color: UI.text.secondary }}>
            {formatDuration(elapsed)}
          </span>
        </DetailRow>

        {/* Cost */}
        <DetailRow label="EST. COST">
          <span className="text-sm" style={{ color: UI.primary }}>
            {formatCost(calculateCost(agent).total)}
          </span>
        </DetailRow>

        {/* Recent Tool Calls */}
        <DetailRow label="RECENT TOOLS">
          <div className="space-y-1">
            {recentTools.length === 0 && (
              <span className="text-xs" style={{ color: UI.text.empty }}>
                No tool calls yet
              </span>
            )}
            {recentTools.map((tc, i) => (
              <div
                key={i}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "var(--color-border)", color: UI.tool }}
              >
                {tc.tool}
                {tc.args && (
                  <span style={{ color: UI.text.dimmed }}> — {tc.args}</span>
                )}
              </div>
            ))}
          </div>
        </DetailRow>

        {/* Summary (if completed) */}
        {agent.summary && (
          <DetailRow label="SUMMARY">
            <span className="text-xs" style={{ color: UI.text.secondary }}>
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
        style={{ color: UI.text.dimmed }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
