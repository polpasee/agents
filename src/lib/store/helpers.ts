import type { AgentState, TeamStatus } from "../types";

/** Derive team status from member statuses */
export function computeTeamStatus(memberIds: string[], agents: Map<string, AgentState>, fallback: TeamStatus): TeamStatus {
  const members = memberIds.map(id => agents.get(id)).filter(Boolean) as AgentState[];
  if (members.some(a => a.status === "error")) return "error";
  if (members.every(a => a.status === "completed")) return "completed";
  if (members.some(a => a.status === "running" || a.status === "idle")) return "active";
  return fallback;
}

export function loadLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = localStorage.getItem(key);
    if (val === null) return fallback;
    try { return JSON.parse(val); } catch { return val as T; }
  } catch { return fallback; }
}
