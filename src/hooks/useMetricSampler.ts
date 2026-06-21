"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { calculateTotalCost } from "@/lib/costs";
import { totalTokens } from "@/lib/utils";
import { METRIC_SAMPLE_INTERVAL_MS } from "@/lib/config";

export function useMetricSampler() {
  const showLiveMetrics = useAgentStore((s) => s.showLiveMetrics);

  useEffect(() => {
    if (!showLiveMetrics) return;

    const interval = setInterval(() => {
      const { agents, pushMetricSample } = useAgentStore.getState();
      const agentList = Array.from(agents.values());

      const activeCount = agentList.filter(
        (a) => a.status === "running" || a.status === "waiting",
      ).length;

      const totalTok = agentList.reduce((sum, a) => sum + totalTokens(a), 0);

      const totalCost = calculateTotalCost(agents).total;

      // Calculate rates from previous sample
      const { metricHistory } = useAgentStore.getState();
      const prev =
        metricHistory.length > 0
          ? metricHistory[metricHistory.length - 1]
          : null;
      const intervalSec = METRIC_SAMPLE_INTERVAL_MS / 1000;
      const tokensPerSec = prev
        ? Math.max(0, (totalTok - prev.totalTokens) / intervalSec)
        : 0;
      const costPerMin = prev
        ? Math.max(
            0,
            (totalCost - prev.totalCost) / (METRIC_SAMPLE_INTERVAL_MS / 60000),
          )
        : 0;

      pushMetricSample({
        timestamp: Date.now(),
        activeCount,
        tokensPerSec,
        costPerMin,
        totalCost,
        totalTokens: totalTok,
      });
    }, METRIC_SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [showLiveMetrics]);
}
