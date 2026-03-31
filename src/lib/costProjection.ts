import type { ActivityEntry, AgentState, CostProjectionData } from "./types";
import { calculateCost } from "./costs";
import { COST_PROJECTION_WINDOW_MS } from "./config";

/** Calculate the current burn rate in $/minute from recent token activity */
export function calculateBurnRate(
  activity: ActivityEntry[],
  agents: Map<string, AgentState>,
  windowMs: number = COST_PROJECTION_WINDOW_MS,
): number {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Find token events in the window
  const recentTokenEvents = activity.filter(
    (a) => a.timestamp >= cutoff && a.event.type === "agent:tokens"
  );

  if (recentTokenEvents.length < 2) return 0;

  // Calculate total cost at the start and end of the window
  let totalCostNow = 0;
  for (const agent of agents.values()) {
    totalCostNow += calculateCost(agent).total;
  }

  // Estimate cost at the start of the window by subtracting tokens gained in window
  // Simplified: use the number of token events as a proxy for activity rate
  // Better: track cost samples over time
  const windowMinutes = windowMs / 60_000;
  const firstEventTime = recentTokenEvents[0].timestamp;
  const lastEventTime = recentTokenEvents[recentTokenEvents.length - 1].timestamp;
  const actualWindowMs = lastEventTime - firstEventTime;

  if (actualWindowMs <= 0) return 0;

  // Burn rate = total cost / elapsed time since first agent started
  let earliestStart = now;
  for (const agent of agents.values()) {
    if (agent.startTime < earliestStart) earliestStart = agent.startTime;
  }
  const totalElapsedMinutes = (now - earliestStart) / 60_000;

  if (totalElapsedMinutes <= 0) return 0;
  return totalCostNow / totalElapsedMinutes;
}

/** Project future costs based on current burn rate */
export function calculateProjection(
  currentTotal: number,
  burnRate: number,
  budget: number | null,
  elapsedMs: number,
): CostProjectionData {
  // Project: if burn rate continues for same duration again
  const elapsedMinutes = elapsedMs / 60_000;
  const projectedTotal = burnRate > 0 ? currentTotal + burnRate * elapsedMinutes : currentTotal;

  let timeToThreshold = Infinity;
  let percentOfBudget = 0;

  if (budget && budget > 0) {
    percentOfBudget = (currentTotal / budget) * 100;
    if (burnRate > 0 && currentTotal < budget) {
      timeToThreshold = (budget - currentTotal) / burnRate;
    } else if (currentTotal >= budget) {
      timeToThreshold = 0;
    }
  }

  return { burnRate, projectedTotal, timeToThreshold, percentOfBudget };
}
