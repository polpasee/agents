import type { AgentState } from "./types";

// Per-million-token pricing (USD) by model family
interface Rates { input: number; output: number; cacheRead: number; cacheWrite: number }

const MODEL_RATES: Record<string, Rates> = {
  opus:    { input: 15,  output: 75,   cacheRead: 1.5,   cacheWrite: 18.75 },
  sonnet:  { input: 3,   output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  haiku:   { input: 0.8, output: 4,    cacheRead: 0.08,  cacheWrite: 1 },
};

const DEFAULT_RATES = MODEL_RATES.opus;

function getRates(model?: string): Rates {
  if (!model) return DEFAULT_RATES;
  const lower = model.toLowerCase();
  if (lower.includes("haiku")) return MODEL_RATES.haiku;
  if (lower.includes("sonnet")) return MODEL_RATES.sonnet;
  return DEFAULT_RATES; // opus or unknown
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function calculateCost(agent: AgentState): CostBreakdown {
  const rates = getRates(agent.model);
  const input = (agent.inputTokens / 1_000_000) * rates.input;
  const output = (agent.outputTokens / 1_000_000) * rates.output;
  const cacheRead = (agent.cacheReadTokens / 1_000_000) * rates.cacheRead;
  const cacheWrite = (agent.cacheCreateTokens / 1_000_000) * rates.cacheWrite;
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
