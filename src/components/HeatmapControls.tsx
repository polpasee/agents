"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import type { HeatmapMetric } from "@/lib/types";

const METRIC_OPTIONS: { value: HeatmapMetric; label: string }[] = [
  { value: "idleRatio", label: "Idle Ratio" },
  { value: "tokenEfficiency", label: "Token Efficiency" },
  { value: "timeToFirstTool", label: "Time to First Tool" },
  { value: "avgToolLatency", label: "Avg Tool Latency" },
];

export function HeatmapControls() {
  const heatmapMetric = useAgentStore((s) => s.heatmapMetric);
  const setHeatmapMetric = useAgentStore((s) => s.setHeatmapMetric);

  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        right: 8,
        zIndex: 10,
        background: "var(--color-panel)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <label
        style={{
          color: UI.text.secondary,
          fontFamily: "monospace",
          fontSize: 9,
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        Heatmap Metric
      </label>
      <select
        value={heatmapMetric}
        onChange={(e) => setHeatmapMetric(e.target.value as HeatmapMetric)}
        style={{
          background: "var(--color-bg)",
          color: UI.text.primary,
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          padding: "4px 6px",
          fontFamily: "monospace",
          fontSize: 11,
          outline: "none",
          cursor: "pointer",
        }}
      >
        {METRIC_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
