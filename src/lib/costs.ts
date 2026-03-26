import type { AgentState } from "./types";

// Claude Opus pricing per million tokens (USD)
const RATES = {
  input: 15,
  output: 75,
  cacheRead: 1.5,
  cacheWrite: 18.75,
};

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function calculateCost(agent: AgentState): CostBreakdown {
  const input = (agent.inputTokens / 1_000_000) * RATES.input;
  const output = (agent.outputTokens / 1_000_000) * RATES.output;
  const cacheRead = (agent.cacheReadTokens / 1_000_000) * RATES.cacheRead;
  const cacheWrite = (agent.cacheCreateTokens / 1_000_000) * RATES.cacheWrite;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

export function calculateTotalCost(agents: Map<string, AgentState>): CostBreakdown {
  const totals: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const agent of agents.values()) {
    const c = calculateCost(agent);
    totals.input += c.input;
    totals.output += c.output;
    totals.cacheRead += c.cacheRead;
    totals.cacheWrite += c.cacheWrite;
    totals.total += c.total;
  }
  return totals;
}
