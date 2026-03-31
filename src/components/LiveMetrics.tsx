"use client";

import { useRef, useEffect, useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import type { MetricSample } from "@/lib/types";
import * as d3 from "d3";

const CHART_WIDTH = 140;
const CHART_HEIGHT = 36;
const CHART_PADDING = 2;

interface MetricConfig {
  key: keyof Omit<MetricSample, "timestamp">;
  label: string;
  color: string;
  format: (v: number) => string;
}

const METRICS: MetricConfig[] = [
  {
    key: "activeCount",
    label: "ACTIVE",
    color: "#00ff88",
    format: (v) => String(Math.round(v)),
  },
  {
    key: "tokensPerSec",
    label: "TOKENS",
    color: UI.primary,
    format: (v) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
      return String(Math.round(v));
    },
  },
  {
    key: "totalCost",
    label: "COST",
    color: "#ffaa00",
    format: (v) => (v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`),
  },
  {
    key: "costPerMin",
    label: "$/MIN",
    color: UI.error,
    format: (v) => (v < 0.01 ? "<$0.01" : `$${v.toFixed(3)}`),
  },
];

function Sparkline({
  data,
  metric,
}: {
  data: MetricSample[];
  metric: MetricConfig;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;

    const values = data.map((d) => d[metric.key] as number);

    const xScale = d3
      .scaleLinear()
      .domain([0, values.length - 1])
      .range([CHART_PADDING, CHART_WIDTH - CHART_PADDING]);

    const yMax = d3.max(values) ?? 1;
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax === 0 ? 1 : yMax])
      .range([CHART_HEIGHT - CHART_PADDING, CHART_PADDING]);

    const line = d3
      .line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    const area = d3
      .area<number>()
      .x((_, i) => xScale(i))
      .y0(CHART_HEIGHT - CHART_PADDING)
      .y1((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    const sel = d3.select(svg);
    sel.selectAll("*").remove();

    sel
      .append("path")
      .datum(values)
      .attr("d", area)
      .attr("fill", `${metric.color}18`);

    sel
      .append("path")
      .datum(values)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", metric.color)
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.8);
  }, [data, metric]);

  return (
    <svg
      ref={svgRef}
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      style={{ display: "block" }}
    />
  );
}

export function LiveMetrics() {
  const showLiveMetrics = useAgentStore((s) => s.showLiveMetrics);
  const toggleLiveMetrics = useAgentStore((s) => s.toggleLiveMetrics);
  const metricHistory = useAgentStore((s) => s.metricHistory);

  const currentValues = useMemo(() => {
    const latest = metricHistory[metricHistory.length - 1];
    if (!latest)
      return { activeCount: 0, tokensPerSec: 0, totalCost: 0, costPerMin: 0, totalTokens: 0 };
    return latest;
  }, [metricHistory]);

  if (!showLiveMetrics) return null;

  return (
    <div
      style={{
        background: "var(--color-panel)",
        borderBottom: `1px solid ${UI.primary}33`,
        padding: "8px 16px",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-xs font-mono tracking-widest"
          style={{ color: UI.primary, textShadow: `0 0 6px ${UI.primary}66` }}
        >
          LIVE METRICS
        </span>
        <button
          onClick={toggleLiveMetrics}
          className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{
            color: UI.text.muted,
            border: `1px solid var(--color-border)`,
            background: "transparent",
          }}
        >
          CLOSE
        </button>
      </div>
      <div className="flex gap-6 flex-wrap">
        {METRICS.map((m) => (
          <div key={m.key} className="flex items-center gap-2">
            <div>
              <div
                className="text-xs font-mono"
                style={{ color: UI.text.muted }}
              >
                {m.label}
              </div>
              <div
                className="text-lg font-mono font-bold"
                style={{
                  color: m.color,
                  textShadow: `0 0 6px ${m.color}66`,
                  lineHeight: 1.1,
                }}
              >
                {m.format(currentValues[m.key] as number)}
              </div>
            </div>
            <Sparkline data={metricHistory} metric={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
