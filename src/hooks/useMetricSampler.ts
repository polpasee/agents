"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { calculateTotalCost } from "@/lib/costs";
import { METRIC_SAMPLE_INTERVAL_MS } from "@/lib/config";

export function useMetricSampler() {
  const showLiveMetrics = useAgentStore((s) => s.showLiveMetrics);

  useEffect(() => {
    if (!showLiveMetrics) return;

    const interval = setInterval(() => {
      const { agents, pushMetricSample } = useAgentStore.getState();
      const agentList = Array.from(agents.values());

      const activeCount = agentList.filter(
        (a) => a.status === "running" || a.status === "waiting"
      ).length;

      const totalTokens = agentList.reduce(
        (sum, a) => sum + a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheCreateTokens,
        0
      );

      const totalCost = calculateTotalCost(agents).total;

      // Approximate tokens/sec from recent growth
      const { metricHistory } = useAgentStore.getState();
      const prev = metricHistory.length > 0 ? metricHistory[metricHistory.length - 1] : null;
      const tokensPerSec = prev ? Math.max(0, (totalTokens - (prev.tokensPerSec * metricHistory.length)) / 1) : 0;
      const costPerMin = totalCost > 0 && metricHistory.length > 0
        ? (totalCost / (metricHistory.length * METRIC_SAMPLE_INTERVAL_MS / 60000))
        : 0;

      pushMetricSample({
        timestamp: Date.now(),
        activeCount,
        tokensPerSec: totalTokens, // store cumulative, display will diff
        costPerMin,
        totalCost,
      });
    }, METRIC_SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [showLiveMetrics]);
}
