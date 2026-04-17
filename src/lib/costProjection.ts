import type { ActivityEntry, AgentState, CostProjectionData } from "./types";
import { calculateCost } from "./costs";
import { COST_PROJECTION_WINDOW_MS } from "./config";

/** Calculate the current burn rate in $/minute.
 *
 *  Uses the requested window when there are ≥2 token events within it (windowed burn),
 *  otherwise falls back to lifetime-average burn (total cost / elapsed since first agent started).
 *  The windowed rate is a better signal of current activity; the fallback keeps the
 *  stat meaningful during slow sessions where events are sparse.
 */
export function calculateBurnRate(
  activity: ActivityEntry[],
  agents: Map<string, AgentState>,
  windowMs: number = COST_PROJECTION_WINDOW_MS,
): number {
  const now = Date.now();
  const cutoff = now - windowMs;

  let totalCostNow = 0;
  for (const agent of agents.values()) {
    totalCostNow += calculateCost(agent).total;
  }
  if (totalCostNow <= 0) return 0;

  // Windowed rate: project per-event cost contribution using a proportional share.
  // We can't reconstruct exact costs at the window boundary without per-event snapshots,
  // so we approximate: assume tokens accrue roughly uniformly, and use the fraction of
  // token events that fall inside the window × totalCostNow / windowMinutes.
  const tokenEvents = activity.filter((a) => a.event.type === "agent:tokens");
  const recentTokenEvents = tokenEvents.filter((a) => a.timestamp >= cutoff);
  if (recentTokenEvents.length >= 2 && tokenEvents.length > 0) {
    const first = recentTokenEvents[0].timestamp;
    const last = recentTokenEvents[recentTokenEvents.length - 1].timestamp;
    const actualWindowMs = last - first;
    if (actualWindowMs > 0) {
      const share = recentTokenEvents.length / tokenEvents.length;
      const costInWindow = totalCostNow * share;
      return costInWindow / (actualWindowMs / 60_000);
    }
  }

  // Fallback: lifetime-average burn
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
