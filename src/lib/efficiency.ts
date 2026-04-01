import type { AgentState, EfficiencyScore } from "./types";

/** Calculate a composite efficiency score for an agent (0-100 scale) */
export function calculateEfficiency(agent: AgentState, allAgents: AgentState[]): EfficiencyScore {
  const tokenEfficiency = calculateTokenEfficiency(agent);
  const toolSuccessRate = calculateToolSuccessRate(agent);
  const completionSpeed = calculateCompletionSpeed(agent, allAgents);
  const overall = Math.round(tokenEfficiency * 0.4 + toolSuccessRate * 0.3 + completionSpeed * 0.3);
  return { overall, tokenEfficiency, toolSuccessRate, completionSpeed };
}

function calculateTokenEfficiency(agent: AgentState): number {
  const total = agent.inputTokens + agent.outputTokens;
  if (total === 0) return 50;
  // Higher output ratio = more productive (generating vs consuming)
  const outputRatio = agent.outputTokens / total;
  // Optimal is ~30% output. Score 100 at 0.3, decreasing toward 0 or 1
  const distance = Math.abs(outputRatio - 0.3);
  return Math.round(Math.max(0, 100 - distance * 200));
}

function calculateToolSuccessRate(agent: AgentState): number {
  if (agent.toolCalls.length === 0) return 50;
  // Tool calls followed by more tool calls or completion = success
  // Tool calls where the next event is an error = failure
  // Simple heuristic: completed agents with tool calls are successful
  const hasError = agent.status === "error";
  if (hasError) return Math.max(10, 50 - agent.toolCalls.length * 5);
  if (agent.status === "completed") return Math.min(100, 60 + agent.toolCalls.length * 2);
  return 50 + Math.min(30, agent.toolCalls.length * 3);
}

function calculateCompletionSpeed(agent: AgentState, allAgents: AgentState[]): number {
  if (!agent.duration && agent.status !== "completed") return 50;
  const elapsed = agent.duration || (Date.now() - agent.startTime);
  // Compare to peers of the same type
  const peers = allAgents.filter(a => a.agentType === agent.agentType && a.id !== agent.id);
  if (peers.length === 0) return 50;
  const peerDurations = peers.map(a => a.duration || (Date.now() - a.startTime)).filter(d => d > 0);
  if (peerDurations.length === 0) return 50;
  const avgPeer = peerDurations.reduce((a, b) => a + b, 0) / peerDurations.length;
  if (avgPeer === 0) return 50;
  // Faster than average = higher score
  const ratio = elapsed / avgPeer;
  if (ratio <= 0.5) return 100;
  if (ratio >= 2) return 0;
  return Math.round(100 - (ratio - 0.5) * 66.7);
}
