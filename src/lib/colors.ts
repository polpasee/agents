import type { AgentType, AgentStatus, AgentState } from "./types";

/**
 * Curated subset of Tailwind v3 colors (https://tailwindcss.com/docs/colors).
 * All UI hex values flow from this single source — change a swatch here and
 * the whole dashboard follows.
 */
const TW = {
  red500: "#ef4444",
  amber400: "#fbbf24",
  amber500: "#f59e0b",
  yellow500: "#eab308",
  green400: "#4ade80",
  emerald400: "#34d399",
  cyan400: "#22d3ee",
  sky400: "#38bdf8",
  blue400: "#60a5fa",
  blue500: "#3b82f6",
  indigo400: "#818cf8",
  violet400: "#a78bfa",
  purple400: "#c084fc",
  fuchsia400: "#e879f9",
  pink400: "#f472b6",
  rose400: "#fb7185",
  red400: "#f87171",
  orange400: "#fb923c",
  yellow400: "#facc15",
  lime400: "#a3e635",
  teal400: "#2dd4bf",
  slate200: "#e2e8f0",
  slate400: "#94a3b8",
  slate800: "#1e293b",
  slate900: "#0f172a",
  slate950: "#020617",
  gray500: "#6b7280",
  gray600: "#4b5563",
  gray700: "#374151",
} as const;

/** Semantic UI colors used across components */
export const UI = {
  primary: TW.cyan400,
  error: TW.red500,
  tool: TW.amber500,
  cache: { read: TW.emerald400, write: TW.amber500 },
  text: {
    primary: TW.slate200,
    secondary: TW.slate400,
    muted: TW.gray500,
    dimmed: TW.gray600,
    empty: TW.gray700,
  },
  model: TW.violet400,
} as const;

export const AGENT_COLORS: Record<AgentType, string> = {
  main: TW.amber400,
  explore: TW.fuchsia400,
  plan: TW.emerald400,
  build: TW.amber500,
  review: TW.violet400,
  test: TW.pink400,
  "team-lead": TW.amber400,
  generic: TW.slate400,
};

/**
 * Hash-driven palette pool used by {@link colorFromString} to give each
 * distinct sub-agent displayType (api-builder, frontend-ui, db-reader, …)
 * its own color. All entries are Tailwind -400 shade so they sit at a
 * consistent vibrance on the dark canvas.
 */
const HASH_PALETTE: readonly string[] = [
  // Listed in the natural Tailwind rainbow order: warm → cool → warm.
  TW.red400,
  TW.orange400,
  TW.amber400,
  TW.yellow400,
  TW.lime400,
  TW.green400,
  TW.emerald400,
  TW.teal400,
  TW.cyan400,
  TW.sky400,
  TW.blue400,
  TW.indigo400,
  TW.violet400,
  TW.purple400,
  TW.fuchsia400,
  TW.pink400,
  TW.rose400,
];

/**
 * Deterministic Tailwind-palette color from a string — used to give each
 * distinct sub-agent displayType its own color even when they share the
 * same coarse agentType category.
 *
 * Hash values are multiplied by the golden-ratio conjugate (φ⁻¹ ≈ 0.618)
 * to get a low-discrepancy distribution, so neighboring names ("api-builder"
 * vs "frontend-ui") land in visually distinct slots of the palette instead
 * of clustering together.
 *
 * Returns 6-digit hex so downstream code that appends hex-alpha digits
 * (e.g. `${color}66` for 40% opacity) produces valid 8-digit hex.
 */
export function colorFromString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const fraction = (Math.abs(h) * 0.6180339887498949) % 1;
  return HASH_PALETTE[Math.floor(fraction * HASH_PALETTE.length)];
}

/** Resolve the display color for an agent — prefer the per-displayType
 *  hash color for sub-agents, fall back to the coarse-category palette. */
export function agentColor(agent: Pick<AgentState, "agentType" | "displayType">): string {
  if (agent.displayType) return colorFromString(agent.displayType);
  return AGENT_COLORS[agent.agentType] || UI.text.secondary;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  running: TW.emerald400,
  waiting: TW.yellow500,
  idle: TW.blue500,
  completed: TW.gray500,
  error: TW.red500,
};

export const BUDGET_COLORS = {
  ok: TW.emerald400,
  warning: TW.yellow500,
  critical: TW.red500,
} as const;

export const HEATMAP_COLORS = {
  healthy: TW.emerald400,
  moderate: TW.yellow500,
  bottleneck: TW.red500,
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
  blocking: TW.red500,
  dependency: TW.yellow500,
} as const;

// F11: Theme color palettes
export const THEME_COLORS = {
  dark: { bg: TW.slate950, panel: TW.slate900, border: TW.slate800, text: TW.slate200 },
  light: { bg: "#f8fafc", panel: "#ffffff", border: TW.slate200, text: "#1e293b" },
} as const;

// F15: Efficiency score colors
export const EFFICIENCY_COLORS = {
  excellent: TW.emerald400,
  good: TW.yellow500,
  poor: TW.red500,
} as const;

export const TEAM_STATUS_COLORS: Record<string, string> = {
  forming: TW.yellow500,
  active: TW.emerald400,
  completed: TW.gray500,
  error: TW.red500,
};

export const CHANGE_COLORS: Record<string, string> = {
  create: TW.emerald400,
  edit: TW.yellow500,
  delete: TW.red500,
};

export const ROLE_COLORS: Record<string, string> = {
  user: TW.cyan400,
  assistant: TW.emerald400,
  system: TW.gray500,
  default: TW.slate400,
};

export const ANNOTATION_COLOR = TW.amber500;

export const METRIC_COLORS = {
  active: TW.emerald400,
  cost: TW.amber500,
} as const;

export const COMPARISON_COLORS = {
  better: TW.emerald400,
  worse: TW.red500,
} as const;
