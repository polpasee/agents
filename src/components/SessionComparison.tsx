"use client";

import type { AgentState } from "@/lib/types";
import { UI, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import { formatNumber, formatDuration } from "@/lib/utils";
import { calculateCost, formatCost } from "@/lib/costs";

interface SessionComparisonProps {
  leftSession: string;
  rightSession: string;
  agents: Map<string, AgentState>;
  onExit: () => void;
}

interface SessionMetrics {
  sessionId: string;
  agentCount: number;
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  agents: AgentState[];
}

function computeMetrics(
  sessionId: string,
  agents: Map<string, AgentState>
): SessionMetrics {
  const sessionAgents = Array.from(agents.values()).filter(
    (a) => (a.sessionId || a.id) === sessionId
  );
  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;

  for (const agent of sessionAgents) {
    totalTokens += agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
    totalCost += calculateCost(agent).total;
    totalDuration += agent.duration ?? 0;
  }

  return { sessionId, agentCount: sessionAgents.length, totalTokens, totalCost, totalDuration, agents: sessionAgents };
}

function deltaColor(a: number, b: number, lowerIsBetter = true): string {
  if (a === b) return UI.text.muted;
  const isBetter = lowerIsBetter ? a < b : a > b;
  return isBetter ? "#00ff88" : "#ff4444";
}

function formatDelta(a: number, b: number, formatter: (n: number) => string): string {
  const diff = a - b;
  if (diff === 0) return "=";
  const sign = diff > 0 ? "+" : "";
  return `${sign}${formatter(Math.abs(diff))}`;
}

export function SessionComparison({ leftSession, rightSession, agents, onExit }: SessionComparisonProps) {
  const metricsA = computeMetrics(leftSession, agents);
  const metricsB = computeMetrics(rightSession, agents);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ background: "var(--color-panel)", borderColor: `${UI.primary}33` }}
      >
        <span className="text-sm font-bold tracking-widest" style={{ color: UI.primary }}>
          SESSION COMPARISON
        </span>
        <button
          onClick={onExit}
          className="px-3 py-1 rounded text-xs font-mono"
          style={{ background: `${UI.error}22`, border: `1px solid ${UI.error}`, color: UI.error }}
        >
          EXIT COMPARISON
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-auto">
        <Panel metrics={metricsA} other={metricsB} label="A" />
        <div style={{ width: 1, background: `${UI.primary}33`, flexShrink: 0 }} />
        <Panel metrics={metricsB} other={metricsA} label="B" />
      </div>
    </div>
  );
}

function Panel({ metrics, other, label }: { metrics: SessionMetrics; other: SessionMetrics; label: string }) {
  return (
    <div className="flex-1 p-4 overflow-auto" style={{ minWidth: 0 }}>
      <div className="mb-4">
        <div className="text-xs font-mono mb-1" style={{ color: UI.text.muted }}>SESSION {label}</div>
        <div className="text-sm font-mono font-bold truncate" style={{ color: UI.text.primary }} title={metrics.sessionId}>
          {metrics.sessionId}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded" style={{ background: "var(--color-bg)", border: `1px solid ${UI.primary}22` }}>
        <MetricRow label="Agents" value={metrics.agentCount.toString()} valueColor={deltaColor(metrics.agentCount, other.agentCount, false)} delta={formatDelta(metrics.agentCount, other.agentCount, (n) => n.toString())} deltaColor={deltaColor(metrics.agentCount, other.agentCount, false)} />
        <MetricRow label="Tokens" value={formatNumber(metrics.totalTokens)} valueColor={deltaColor(metrics.totalTokens, other.totalTokens)} delta={formatDelta(metrics.totalTokens, other.totalTokens, formatNumber)} deltaColor={deltaColor(metrics.totalTokens, other.totalTokens)} />
        <MetricRow label="Cost" value={formatCost(metrics.totalCost)} valueColor={deltaColor(metrics.totalCost, other.totalCost)} delta={formatDelta(metrics.totalCost, other.totalCost, (n) => formatCost(n))} deltaColor={deltaColor(metrics.totalCost, other.totalCost)} />
        <MetricRow label="Duration" value={formatDuration(metrics.totalDuration)} valueColor={deltaColor(metrics.totalDuration, other.totalDuration)} delta={formatDelta(metrics.totalDuration, other.totalDuration, formatDuration)} deltaColor={deltaColor(metrics.totalDuration, other.totalDuration)} />
      </div>

      <div className="text-xs font-mono mb-2" style={{ color: UI.text.muted }}>AGENTS ({metrics.agents.length})</div>
      <div className="space-y-2">
        {metrics.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
        {metrics.agents.length === 0 && (
          <div className="text-xs" style={{ color: UI.text.empty }}>No agents in this session</div>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, valueColor, delta, deltaColor: dColor }: { label: string; value: string; valueColor: string; delta: string; deltaColor: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: UI.text.muted }}>{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold font-mono" style={{ color: valueColor }}>{value}</span>
        <span className="text-xs font-mono" style={{ color: dColor, opacity: 0.8 }}>{delta}</span>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const cost = calculateCost(agent);
  const tokens = agent.inputTokens + agent.outputTokens;
  const statusColor = STATUS_COLORS[agent.status] ?? UI.text.muted;
  const typeLabel = AGENT_LABELS[agent.agentType] ?? "AGENT";

  return (
    <div className="p-2 rounded text-xs font-mono" style={{ background: "var(--color-panel)", border: `1px solid ${UI.primary}15` }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span style={{ color: UI.primary }}>{typeLabel}</span>
          <span className="truncate" style={{ color: UI.text.secondary, maxWidth: 140 }}>{agent.task?.slice(0, 50)}</span>
        </div>
        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${statusColor}22`, color: statusColor }}>
          {agent.status.toUpperCase()}
        </span>
      </div>
      <div className="flex gap-4" style={{ color: UI.text.muted }}>
        <span>{formatNumber(tokens)} tok</span>
        <span>{formatCost(cost.total)}</span>
        {agent.duration != null && <span>{formatDuration(agent.duration)}</span>}
      </div>
    </div>
  );
}
