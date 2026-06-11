"use client";

import { useEffect, useState, useCallback } from "react";
import { UI, getBarColor } from "@/lib/colors";
import { formatCost } from "@/lib/costs";
import { formatResetTime } from "@/lib/utils";
import { useApiUsage } from "@/hooks/useApiUsage";

interface CostBuckets {
  day: number;
  week: number;
  month: number;
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

/** Two-column row inside the cost grid: label on the left, dollar value on the right. */
function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span style={{ color: UI.text.dimmed }}>{label}</span>
      <span style={{ color: UI.text.primary, textAlign: "right" }}>
        {formatCost(value)}
      </span>
    </>
  );
}

/**
 * Compact Session/Weekly usage indicator placed in the top-right corner of
 * the topology viewport. Mirrors the bars in {@link UsagePanel} but laid out
 * for an overlay rather than the sidebar. The left section shows rolling
 * cost totals (Day/Week/Month) sourced from `/api/costs`, which scans every
 * Claude Code JSONL session on disk — covers all sessions, not just ones
 * the WS server currently holds.
 */
export function TopologyUsageStatus() {
  const { data: apiUsage } = useApiUsage();
  const [cost, setCost] = useState<CostBuckets>({ day: 0, week: 0, month: 0 });

  const fetchCosts = useCallback(() => {
    fetch("/api/costs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CostBuckets | null) => { if (data) setCost(data); })
      .catch(() => { /* leave previous values in place on transient failures */ });
  }, []);

  useEffect(() => {
    fetchCosts();
    // Server now caches scans for 5 min (CACHE_TTL_MS in cost-history.ts);
    // a 60s client poll means most calls are cache hits and the cold path
    // only fires ~12 times an hour.
    const id = setInterval(fetchCosts, 60_000);
    return () => clearInterval(id);
  }, [fetchCosts]);

  if (!apiUsage) return null;

  const now = Date.now();
  const blockPercent = apiUsage.blockPercent ?? 0;
  const weeklyPercent = apiUsage.weeklyPercent ?? 0;
  const blockResetMs = apiUsage.blockResetAt ? new Date(apiUsage.blockResetAt).getTime() - now : 0;
  const weeklyResetMs = apiUsage.weeklyResetAt ? new Date(apiUsage.weeklyResetAt).getTime() - now : 0;

  return (
    <div
      className="absolute top-2 right-2 z-10 rounded font-mono flex items-center"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-border)",
        padding: "4px 8px",
        pointerEvents: "auto",
        fontSize: 10,
        lineHeight: 1.3,
        gap: 12,
      }}
    >
      {/* Left section: Day/Week/Month rolling cost */}
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: "auto auto",
          columnGap: 6,
          rowGap: 2,
          paddingRight: 12,
          borderRight: "1px solid var(--color-border)",
        }}
      >
        <CostRow label="Day" value={cost.day} />
        <CostRow label="Week" value={cost.week} />
        <CostRow label="Month" value={cost.month} />
      </div>

      {/* Right section: Session/Weekly rate-limit bars */}
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: "auto auto auto",
          columnGap: 8,
          rowGap: 2,
        }}
      >
        <BarRow label="Session" percent={blockPercent} resetMs={blockResetMs} />
        <BarRow label="Weekly" percent={weeklyPercent} resetMs={weeklyResetMs} />
      </div>
    </div>
  );
}
