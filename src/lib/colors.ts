import type { AgentType, AgentStatus } from "./types";

export const AGENT_COLORS: Record<AgentType, string> = {
  main: "#00f5ff",
  explore: "#ff00ff",
  plan: "#00ff88",
  build: "#ffaa00",
  review: "#a78bfa",
  test: "#f472b6",
  "team-lead": "#fbbf24",
  generic: "#94a3b8",
};

export const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "#00ff88",
  waiting: "#eab308",
  idle: "#3b82f6",
  completed: "#6b7280",
  error: "#ff4444",
};

export const AGENT_LABELS: Record<AgentType, string> = {
  main: "MAIN",
  explore: "EXPLORE",
  plan: "PLAN",
  build: "BUILD",
  review: "REVIEW",
  test: "TEST",
  "team-lead": "LEAD",
  generic: "AGENT",
};
