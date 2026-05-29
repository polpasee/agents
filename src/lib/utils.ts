import type { AgentState } from "./types";

/** Sum all four token fields for an agent. */
export function totalTokens(agent: AgentState): number {
  return agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
}

/** Calculate context window usage as a percentage (0–100). */
export function getTokenPercent(agent: AgentState): number {
  const used = agent.inputTokens + agent.outputTokens;
  return agent.contextWindow > 0
    ? Math.min((used / agent.contextWindow) * 100, 100)
    : 0;
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
