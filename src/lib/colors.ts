import type { AgentType, AgentStatus, AgentState } from "./types";

/** Semantic UI colors used across components */
export const UI = {
  primary: "#00f5ff",
  error: "#ff4444",
  tool: "#ffaa00",
  cache: { read: "#00ff88", write: "#ffaa00" },
  text: {
    primary: "#e2e8f0",
    secondary: "#94a3b8",
    muted: "#666",
    dimmed: "#555",
    empty: "#444",
  },
  model: "#a78bfa",
} as const;

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

/**
 * Deterministic hue-family color from a string — used to give each distinct
 * sub-agent displayType (api-builder, frontend-ui, db-reader, …) its own
 * color even when they share the same coarse agentType category. Uses HSL
 * with fixed saturation/lightness so colors stay vivid on the dark canvas.
 *
 * Hash values are multiplied by the golden-ratio conjugate (φ⁻¹ ≈ 0.618)
 * to get a low-discrepancy distribution — guarantees that neighboring
 * names (like "api-builder" vs "frontend-ui") land in visually distinct
 * parts of the hue wheel instead of clustering.
 */
export function colorFromString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const hue = Math.floor((((Math.abs(h) * 0.6180339887498949) % 1) * 360));
  return `hsl(${hue}, 75%, 65%)`;
}

/** Resolve the display color for an agent — prefer the per-displayType
 *  hash color for sub-agents, fall back to the coarse-category palette. */
export function agentColor(agent: Pick<AgentState, "agentType" | "displayType">): string {
  if (agent.displayType) return colorFromString(agent.displayType);
  return AGENT_COLORS[agent.agentType] || UI.text.secondary;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "#00ff88",
  waiting: "#eab308",
  idle: "#3b82f6",
  completed: "#6b7280",
  error: "#ff4444",
};

export const BUDGET_COLORS = {
  ok: "#00ff88",
  warning: "#eab308",
  critical: "#ff4444",
} as const;

export const HEATMAP_COLORS = {
  healthy: "#00ff88",
  moderate: "#eab308",
  bottleneck: "#ff4444",
} as const;

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

// F1: Dependency/blocking edge colors
export const EDGE_COLORS = {
  blocking: "#ff4444",
  dependency: "#eab308",
} as const;

// F11: Theme color palettes
export const THEME_COLORS = {
  dark: { bg: "#0a0a1a", panel: "#0d1117", border: "#1a1a2e", text: "#e2e8f0" },
  light: { bg: "#f8fafc", panel: "#ffffff", border: "#e2e8f0", text: "#1e293b" },
} as const;

// F15: Efficiency score colors
export const EFFICIENCY_COLORS = {
  excellent: "#00ff88",
  good: "#eab308",
  poor: "#ff4444",
} as const;

export const TEAM_STATUS_COLORS: Record<string, string> = {
  forming: "#eab308",
  active: "#00ff88",
  completed: "#6b7280",
  error: "#ff4444",
};

export const CHANGE_COLORS: Record<string, string> = {
  create: "#00ff88",
  edit: "#eab308",
  delete: "#ff4444",
};

export const ROLE_COLORS: Record<string, string> = {
  user: "#00f5ff",
  assistant: "#00ff88",
  system: "#6b7280",
  default: "#94a3b8",
};

export const ANNOTATION_COLOR = "#f59e0b";

export const METRIC_COLORS = {
  active: "#00ff88",
  cost: "#ffaa00",
} as const;

export const COMPARISON_COLORS = {
  better: "#00ff88",
  worse: "#ff4444",
} as const;
