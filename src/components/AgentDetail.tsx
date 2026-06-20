"use client";

import { useState, useEffect, useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  AGENT_COLORS,
  STATUS_COLORS,
  AGENT_LABELS,
  UI,
  EFFICIENCY_COLORS,
  BUDGET_COLORS,
} from "@/lib/colors";
import { getTokenPercent, formatNumber, formatDuration } from "@/lib/utils";
import { calculateCost, formatCost } from "@/lib/costs";
import { calculateEfficiency } from "@/lib/efficiency";
import type { AgentState, AgentTypeBudgets } from "@/lib/types";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { useWorkflowLabels } from "@/hooks/useWorkflowLabels";

function efficiencyColor(v: number): string {
  return v >= 70
    ? EFFICIENCY_COLORS.excellent
    : v >= 40
      ? EFFICIENCY_COLORS.good
      : EFFICIENCY_COLORS.poor;
}

export function AgentDetail() {
  const {
    agents,
    teams,
    selectedAgentId,
    logEntries,
    agentTypeBudgets,
    agentDiffs,
  } = useAgentStore(
    useShallow((s) => ({
      agents: s.agents,
      teams: s.teams,
      selectedAgentId: s.selectedAgentId,
      logEntries: s.logEntries,
      agentTypeBudgets: s.agentTypeBudgets,
      agentDiffs: s.agentDiffs,
    })),
  );
  const agent = selectedAgentId ? agents.get(selectedAgentId) : null;
  const openLogViewer = useAgentStore((s) => s.openLogViewer);
  const setLogLoading = useAgentStore((s) => s.setLogLoading);
  const openErrorDrillDown = useAgentStore((s) => s.openErrorDrillDown);
  const openDiffViewer = useAgentStore((s) => s.openDiffViewer);
  const workflowLabels = useWorkflowLabels();

  const handleViewLog = () => {
    if (!agent) return;
    openLogViewer(agent.id);
    if (!logEntries.has(agent.id)) {
      setLogLoading(agent.id, true);
      const fail = (msg: string, ...err: unknown[]) => {
        useAgentStore.getState().setLogLoading(agent.id, false);
        console.warn(msg, ...err);
      };
      void (async () => {
        try {
          const res = await fetch(`/api/logs/${encodeURIComponent(agent.id)}`);
          if (!res.ok) {
            const { error } = await res
              .json()
              .catch(() => ({ error: res.statusText }));
            fail("Log fetch failed:", error);
            return;
          }
          const body = await res.json();
          if (!Array.isArray(body.entries)) {
            fail("Log fetch returned non-array entries");
            return;
          }
          useAgentStore.getState().setLogEntries(agent.id, body.entries);
        } catch (err) {
          fail("Log fetch threw:", err);
        }
      })();
    }
  };

  // Live timer for running agents — force re-render every second
  const [, tick] = useState(0);
  const isRunning =
    agent && agent.status !== "completed" && agent.status !== "error";
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
  const wfLabel = workflowLabels.get(agent.id);
  const secondary = wfLabel ?? agent.workflowName ?? agent.displayType;
  const totalTokens = agent.inputTokens + agent.outputTokens;
  const tokenPercent = getTokenPercent(agent);
  const elapsed = agent.duration ?? Date.now() - agent.startTime;

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
          {secondary &&
            secondary.toLowerCase() !==
              AGENT_LABELS[agent.agentType].toLowerCase() && (
              <span
                className="text-xs font-mono"
                style={{ color: UI.text.muted }}
              >
                {secondary}
              </span>
            )}
          <button
            onClick={handleViewLog}
            className="ml-auto px-1.5 py-0.5 rounded text-xs font-mono"
            style={{
              background: `${UI.primary}11`,
              border: `1px solid ${UI.primary}44`,
              color: UI.primary,
            }}
            title="View conversation log"
          >
            LOG
          </button>
          {agentDiffs.has(agent.id) && (
            <button
              onClick={() => openDiffViewer(agent.id)}
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: `${UI.primary}11`,
                border: `1px solid ${UI.primary}44`,
                color: UI.primary,
              }}
              title="View file changes"
            >
              DIFFS
            </button>
          )}
        </div>
        <div
          className="text-xs mt-0.5 truncate"
          style={{ color: UI.text.dimmed }}
        >
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
              style={{
                background: statusColor,
                boxShadow: `0 0 4px ${statusColor}`,
              }}
            />
            <span className="capitalize text-sm" style={{ color: statusColor }}>
              {agent.status}
            </span>
            {agent.status === "error" && (
              <button
                onClick={() => openErrorDrillDown(agent.id)}
                className="ml-2 px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer"
                style={{
                  background: `${STATUS_COLORS.error}22`,
                  border: `1px solid ${STATUS_COLORS.error}44`,
                  color: STATUS_COLORS.error,
                }}
              >
                VIEW ERROR
              </button>
            )}
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
                in:{" "}
                <span style={{ color: UI.text.secondary }}>
                  {formatNumber(agent.inputTokens)}
                </span>
              </span>
              <span style={{ color: UI.text.dimmed }}>
                out:{" "}
                <span style={{ color: UI.text.secondary }}>
                  {formatNumber(agent.outputTokens)}
                </span>
              </span>
            </div>
            {(agent.cacheReadTokens > 0 || agent.cacheCreateTokens > 0) && (
              <div className="flex gap-3 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  cache read:{" "}
                  <span style={{ color: UI.cache.read }}>
                    {formatNumber(agent.cacheReadTokens)}
                  </span>
                </span>
                <span style={{ color: UI.text.dimmed }}>
                  cache write:{" "}
                  <span style={{ color: UI.cache.write }}>
                    {formatNumber(agent.cacheCreateTokens)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </DetailRow>

        {/* F3: Token Budget */}
        <TokenBudgetRow
          agent={agent}
          agentTypeBudgets={agentTypeBudgets}
          totalTokens={totalTokens}
        />

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

        {/* Efficiency Score (F15) */}
        <EfficiencyDisplay agent={agent} agents={agents} />

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

        {/* Annotations */}
        <DetailRow label="ANNOTATIONS">
          <AnnotationOverlay agentId={agent.id} />
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

function EfficiencyDisplay({
  agent,
  agents,
}: {
  agent: AgentState;
  agents: Map<string, AgentState>;
}) {
  const score = useMemo(
    () => calculateEfficiency(agent, Array.from(agents.values())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally memoized on the scalar fields that affect the score, not the whole agent/agents object identities
    [
      agent.inputTokens,
      agent.outputTokens,
      agent.toolCalls.length,
      agent.status,
      agent.duration,
      agents.size,
    ],
  );
  const color = efficiencyColor(score.overall);

  const bars: { label: string; value: number }[] = [
    { label: "Token Eff.", value: score.tokenEfficiency },
    { label: "Tool Success", value: score.toolSuccessRate },
    { label: "Speed", value: score.completionSpeed },
  ];

  return (
    <DetailRow label="EFFICIENCY">
      <div>
        <span className="text-sm font-bold" style={{ color }}>
          {score.overall}
        </span>
        <span className="text-xs" style={{ color: UI.text.dimmed }}>
          {" "}
          / 100
        </span>
        <div className="mt-1.5 space-y-1">
          {bars.map((bar) => {
            const barColor = efficiencyColor(bar.value);
            return (
              <div key={bar.label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span style={{ color: UI.text.dimmed }}>{bar.label}</span>
                  <span style={{ color: UI.text.secondary }}>{bar.value}</span>
                </div>
                <div
                  className="h-[3px] rounded-full overflow-hidden"
                  style={{ background: "var(--color-border)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${bar.value}%`,
                      background: barColor,
                      boxShadow: `0 0 4px ${barColor}`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DetailRow>
  );
}

function TokenBudgetRow({
  agent,
  agentTypeBudgets,
  totalTokens,
}: {
  agent: AgentState;
  agentTypeBudgets: AgentTypeBudgets;
  totalTokens: number;
}) {
  const budgetLimit = agentTypeBudgets[agent.agentType];
  if (budgetLimit == null) return null;
  const budgetPercent = Math.min((totalTokens / budgetLimit) * 100, 100);
  const exceeded = agent.budgetExceeded;
  const barColor = exceeded
    ? BUDGET_COLORS.critical
    : budgetPercent > 80
      ? BUDGET_COLORS.warning
      : BUDGET_COLORS.ok;
  return (
    <DetailRow label="TOKEN BUDGET">
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-sm" style={{ color: barColor }}>
            {formatNumber(totalTokens)}
          </span>
          <span className="text-xs" style={{ color: UI.text.dimmed }}>
            / {formatNumber(budgetLimit)}
          </span>
          {exceeded && (
            <span
              className="text-xs font-bold"
              style={{ color: BUDGET_COLORS.critical }}
            >
              EXCEEDED
            </span>
          )}
        </div>
        <div
          className="mt-1 h-1 rounded-full overflow-hidden"
          style={{ background: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${budgetPercent}%`, background: barColor }}
          />
        </div>
      </div>
    </DetailRow>
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
