"use client";

import { useEffect, useState, useCallback } from "react";
import { UI, BUDGET_COLORS } from "@/lib/colors";

function getBarColor(percent: number): string {
  if (percent > 85) return BUDGET_COLORS.critical;
  if (percent > 60) return BUDGET_COLORS.warning;
  return BUDGET_COLORS.ok;
}

function formatResetTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d${remHours}h`;
  }
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

interface ApiUsage {
  blockPercent: number | null;
  weeklyPercent: number | null;
  blockResetAt: string | null;
  weeklyResetAt: string | null;
}

function BarRow({ label, percent, resetMs }: { label: string; percent: number; resetMs: number }) {
  const color = getBarColor(percent);
  return (
    <>
      {/* Col 1: label */}
      <span style={{ color: UI.text.dimmed }}>{label}</span>
      {/* Col 2: bar + percent */}
      <div className="flex items-center gap-1.5">
        <div
          className="rounded-full overflow-hidden"
          style={{ width: 60, height: 3, background: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(percent, 100)}%`,
              background: color,
              boxShadow: `0 0 3px ${color}88`,
            }}
          />
        </div>
        <span style={{ color, textAlign: "right", minWidth: 24 }}>
          {Math.round(percent)}%
        </span>
      </div>
      {/* Col 3: reset time */}
      <span style={{ color: UI.text.dimmed }}>
        {formatResetTime(Math.max(0, resetMs))}
      </span>
    </>
  );
}

/**
 * Compact Session/Weekly usage indicator placed in the top-right corner of
 * the topology viewport. Mirrors the bars in {@link UsagePanel} but laid out
 * for an overlay rather than the sidebar.
 */
export function TopologyUsageStatus() {
  const [apiUsage, setApiUsage] = useState<ApiUsage | null>(null);

  const fetchUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setApiUsage(data); })
      .catch(() => { /* network/parse errors fall back to a hidden overlay */ });
  }, []);

  useEffect(() => {
    fetchUsage();
    const id = setInterval(fetchUsage, 10_000);
    return () => clearInterval(id);
  }, [fetchUsage]);

  if (!apiUsage) return null;

  const now = Date.now();
  const blockPercent = apiUsage.blockPercent ?? 0;
  const weeklyPercent = apiUsage.weeklyPercent ?? 0;
  const blockResetMs = apiUsage.blockResetAt ? new Date(apiUsage.blockResetAt).getTime() - now : 0;
  const weeklyResetMs = apiUsage.weeklyResetAt ? new Date(apiUsage.weeklyResetAt).getTime() - now : 0;

  return (
    <div
      className="absolute top-2 right-2 z-10 rounded font-mono grid items-center"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-border)",
        padding: "4px 8px",
        pointerEvents: "auto",
        fontSize: 10,
        lineHeight: 1.3,
        gridTemplateColumns: "auto auto auto",
        columnGap: 8,
        rowGap: 2,
      }}
    >
      <BarRow label="Session" percent={blockPercent} resetMs={blockResetMs} />
      <BarRow label="Weekly" percent={weeklyPercent} resetMs={weeklyResetMs} />
    </div>
  );
}
