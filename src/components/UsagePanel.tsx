"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useAgentStore } from "@/lib/store";
import { UI, BUDGET_COLORS } from "@/lib/colors";
import { formatNumber, formatDuration } from "@/lib/utils";
import { calculateTotalCost, formatCost } from "@/lib/costs";

function getBarColor(percent: number): string {
  if (percent > 85) return BUDGET_COLORS.critical;
  if (percent > 60) return BUDGET_COLORS.warning;
  return BUDGET_COLORS.ok;
}

/** Format ms as "Xhr Xm" for reset timers (matches Claude Code status line) */
function formatResetTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) return `${hours}hr ${minutes}m`;
  return `${minutes}m`;
}

interface ApiUsage {
  blockPercent: number | null;
  weeklyPercent: number | null;
  blockResetAt: string | null;
  weeklyResetAt: string | null;
  plan: string | null;
}

function UsageBar({ label, percent, resetMs }: { label: string; percent: number; resetMs: number }) {
  const color = getBarColor(percent);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span style={{ color: UI.text.dimmed, minWidth: 40 }}>{label}</span>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 4, background: "var(--color-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(percent, 100)}%`,
            background: color,
            boxShadow: `0 0 4px ${color}88`,
          }}
        />
      </div>
      <span style={{ color, minWidth: 36, textAlign: "right" }}>
        {percent.toFixed(1)}%
      </span>
      <span style={{ color: UI.text.dimmed, minWidth: 48, textAlign: "right" }}>
        {formatResetTime(Math.max(0, resetMs))}
      </span>
    </div>
  );
}

export function UsagePanel() {
  const agents = useAgentStore((s) => s.agents);
  const [apiUsage, setApiUsage] = useState<ApiUsage | null>(null);

  const [usageError, setUsageError] = useState(false);
  const fetchUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { if (data) { setApiUsage(data); setUsageError(false); } })
      .catch(() => { setUsageError(true); });
  }, []);

  // Poll API usage every 10 seconds
  useEffect(() => {
    fetchUsage();
    const id = setInterval(fetchUsage, 10_000);
    return () => clearInterval(id);
  }, [fetchUsage]);

  const stats = useMemo(() => {
    const list = Array.from(agents.values());
    let totalUsed = 0;
    let totalWindow = 0;
    let totalAllTokens = 0;
    let earliest = Infinity;
    let hasActive = false;

    for (const a of list) {
      totalUsed += a.inputTokens + a.outputTokens;
      totalWindow += a.contextWindow;
      totalAllTokens += a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheCreateTokens;
      if (a.startTime < earliest) earliest = a.startTime;
      if (a.status === "running" || a.status === "idle" || a.status === "waiting") hasActive = true;
    }

    const contextPercent = totalWindow > 0 ? Math.min((totalUsed / totalWindow) * 100, 100) : 0;
    const cost = calculateTotalCost(agents);

    return { totalUsed, totalWindow, contextPercent, totalAllTokens, cost, earliest, hasActive };
  }, [agents]);

  // Live timer — re-render every second
  const [, tick] = useState(0);
  useEffect(() => {
    if (!stats.hasActive && agents.size === 0) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [stats.hasActive, agents.size]);

  if (agents.size === 0 && !apiUsage) return null;

  const barColor = getBarColor(stats.contextPercent);
  const elapsed = stats.earliest < Infinity ? Date.now() - stats.earliest : 0;

  const now = Date.now();
  const blockPercent = apiUsage?.blockPercent ?? 0;
  const weeklyPercent = apiUsage?.weeklyPercent ?? 0;
  const blockResetMs = apiUsage?.blockResetAt
    ? new Date(apiUsage.blockResetAt).getTime() - now
    : 0;
  const weeklyResetMs = apiUsage?.weeklyResetAt
    ? new Date(apiUsage.weeklyResetAt).getTime() - now
    : 0;

  return (
    <div
      className="px-3 py-2 space-y-1.5"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      <div
        className="text-xs uppercase tracking-wider"
        style={{ color: UI.text.muted }}
      >
        Usage
      </div>

      {/* Context bar */}
      {agents.size > 0 && (
        <>
          <div>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span style={{ color: UI.text.dimmed }}>Context</span>
              <span style={{ color: UI.text.secondary }}>
                {formatNumber(stats.totalUsed)} / {formatNumber(stats.totalWindow)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: 3, background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${stats.contextPercent}%`,
                    background: barColor,
                    boxShadow: `0 0 4px ${barColor}88`,
                  }}
                />
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: barColor, minWidth: 32, textAlign: "right" }}>
                {stats.contextPercent.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center justify-between text-xs">
            <div>
              <span style={{ color: UI.text.dimmed }}>Tokens </span>
              <span style={{ color: UI.text.secondary }}>{formatNumber(stats.totalAllTokens)}</span>
            </div>
            <div>
              <span style={{ color: UI.text.dimmed }}>Cost </span>
              <span style={{ color: UI.primary, textShadow: `0 0 6px ${UI.primary}44` }}>
                {formatCost(stats.cost.total)}
              </span>
            </div>
          </div>

          {/* Runtime */}
          <div className="text-xs">
            <span style={{ color: UI.text.dimmed }}>Runtime </span>
            <span style={{ color: UI.text.secondary }}>{formatDuration(elapsed)}</span>
          </div>
        </>
      )}

      {/* API usage fetch error */}
      {usageError && !apiUsage && (
        <div className="text-xs" style={{ color: UI.text.dimmed }}>
          Usage data unavailable
        </div>
      )}

      {/* Block & Weekly usage bars from real API data */}
      {apiUsage && (
        <div
          className="pt-1.5 space-y-1"
          style={agents.size > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
        >
          <UsageBar label="Block" percent={blockPercent} resetMs={blockResetMs} />
          <UsageBar label="Weekly" percent={weeklyPercent} resetMs={weeklyResetMs} />
        </div>
      )}
    </div>
  );
}
