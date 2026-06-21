import type { AgentState } from "./types";

// Per-million-token pricing (USD) by model family
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MODEL_RATES: Record<string, Rates> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

// safe: opus key is defined in the literal above; assertion avoids `| undefined` from Record<string, Rates>
const DEFAULT_RATES: Rates = MODEL_RATES["opus"]!;

function getRates(model?: string): Rates {
  if (!model) return DEFAULT_RATES;
  const lower = model.toLowerCase();
  // safe: haiku/sonnet keys are defined in the literal above
  if (lower.includes("haiku")) return MODEL_RATES["haiku"]!;
  if (lower.includes("sonnet")) return MODEL_RATES["sonnet"]!;
  return DEFAULT_RATES; // opus or unknown
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Token counts extracted from a single Claude API usage record. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/** Per-token cost breakdown for an arbitrary usage record (no AgentState
 *  required). Shared by {@link calculateCost} and the JSONL history scanner
 *  so both paths apply identical model-rate logic. */
export function costFromUsage(
  usage: TokenUsage,
  model?: string,
): CostBreakdown {
  const rates = getRates(model);
  const input = (usage.inputTokens / 1_000_000) * rates.input;
  const output = (usage.outputTokens / 1_000_000) * rates.output;
  const cacheRead = (usage.cacheReadTokens / 1_000_000) * rates.cacheRead;
  const cacheWrite = (usage.cacheCreateTokens / 1_000_000) * rates.cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

/** Calculate per-agent token cost breakdown based on model pricing. */
export function calculateCost(agent: AgentState): CostBreakdown {
  return costFromUsage(agent, agent.model);
}

/** Format a dollar amount for display (e.g. "$1.23" or "<$0.01"). */
export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

/** Sum cost breakdowns across all agents. */
export function calculateTotalCost(
  agents: Map<string, AgentState>,
): CostBreakdown {
  const totals: CostBreakdown = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
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
