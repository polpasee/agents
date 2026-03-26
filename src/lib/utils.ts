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
