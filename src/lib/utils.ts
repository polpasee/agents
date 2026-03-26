import type { AgentState } from "./types";

export function getTokenPercent(agent: AgentState): number {
  const totalTokens = agent.inputTokens + agent.outputTokens;
  return agent.contextWindow > 0
    ? Math.min((totalTokens / agent.contextWindow) * 100, 100)
    : 0;
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function truncateId(id: string, len = 8): string {
  return id.slice(0, len);
}
