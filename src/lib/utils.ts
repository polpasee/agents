import type { AgentState } from "./types";

/** Sum all four token fields for an agent. */
export function totalTokens(agent: AgentState): number {
  return (
    agent.inputTokens +
    agent.outputTokens +
    agent.cacheReadTokens +
    agent.cacheCreateTokens
  );
}

/** Calculate context window usage as a percentage (0–100). */
export function getTokenPercent(agent: AgentState): number {
  const used = agent.inputTokens + agent.outputTokens;
  return agent.contextWindow > 0
    ? Math.min((used / agent.contextWindow) * 100, 100)
    : 0;
}

/** Earliest `startTime` across agents, or `fallback` when there are none.
 *  Avoids `Math.min(...arr)` — argument-list spread blows the stack at
 *  ~80k+ items. Fold instead so this scales linearly without limit. */
export function earliestStartTime(
  agents: Iterable<Pick<AgentState, "startTime">>,
  fallback: number,
): number {
  let earliest = Infinity;
  for (const a of agents) if (a.startTime < earliest) earliest = a.startTime;
  return earliest === Infinity ? fallback : earliest;
}

/** Format a number with k/M suffixes for compact display. */
export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

/** Format milliseconds as "Xm Ys". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Format ms as "Xd Xhr" / "Xhr Xm" / "Xm" for reset timers (matches Claude Code status line) */
export function formatResetTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}hr`;
  }
  if (hours > 0) return `${hours}hr ${minutes}m`;
  return `${minutes}m`;
}

/** Truncate an ID string to the given length for display. */
export function truncateId(id: string, len = 8): string {
  return id.slice(0, len);
}

/** Format a Unix timestamp as "HH:MM:SS" (24h) for display in logs and streams. */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format a Unix timestamp as "HH:MM" (24h, no seconds) for compact display. */
export function formatTimestampShort(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}
