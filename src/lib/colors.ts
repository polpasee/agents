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

/** Amber is reserved for the main agent — never appears in the sub-agent
 *  palette so the lead is always visually identifiable. */
export const MAIN_AGENT_COLOR = TW.amber400;

export const AGENT_COLORS: Record<AgentType, string> = {
  main: MAIN_AGENT_COLOR,
  explore: TW.fuchsia400,
  plan: TW.emerald400,
  build: TW.amber500,
  review: TW.violet400,
  test: TW.pink400,
  "team-lead": TW.sky400,
  generic: TW.slate400,
};

/**
 * Palette pool for sub-agents. Each agent id claims the next slot in
 * insertion order, so two visible nodes never share a color until the
 * palette is exhausted (slot N wraps to slot 0). Amber is reserved for
 * the main agent (see {@link MAIN_AGENT_COLOR}); red, rose, and yellow
 * are omitted because they read as error/warning/waiting signals
 * elsewhere in the UI.
 * All entries are Tailwind -400 shade for consistent vibrance on dark canvas.
 */
const AGENT_PALETTE: readonly string[] = [
  // Listed in the natural Tailwind rainbow order: warm → cool → warm.
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
];

/**
 * Per-instance color registry: agentId → hex color. Lives at module scope
 * so colors are stable across re-renders without flowing through Zustand
 * (avoids selector cascades on every new agent). Reset between tests via
 * {@link resetAgentColorRegistry}.
 */
const colorByAgentId = new Map<string, string>();

/**
 * djb2 hash — small, fast, good distribution for short strings.
 * Returns a signed 32-bit integer.
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash;
}

/**
 * Returns the registered color for an agent id, assigning a deterministic
 * palette slot on first lookup. The slot is derived from a stable hash of the
 * id, so registration order never affects which color an id receives.
 * The map acts as a per-session cache so repeated lookups are O(1).
 */
export function assignAgentColor(id: string): string {
  const existing = colorByAgentId.get(id);
  if (existing) return existing;
  const slot = Math.abs(djb2(id)) % AGENT_PALETTE.length;
  const color = AGENT_PALETTE[slot];
  colorByAgentId.set(id, color);
  return color;
}

/** Remove a single entry from the registry (call from removeAgent to prevent leaks). */
export function releaseAgentColor(id: string): void {
  colorByAgentId.delete(id);
}

/** Test-only: clear the entire registry. */
export function resetAgentColorRegistry(): void {
  colorByAgentId.clear();
}

/** Resolve the display color for an agent — main agents always render in
 *  the reserved amber; every other distinct agent claims its own palette slot.
 *  The registry key is resolved as the first non-empty value of: id → slug →
 *  displayType. When all three are empty, returns UI.text.secondary. */
export function agentColor(
  agent: Pick<AgentState, "id" | "agentType" | "slug" | "displayType">
): string {
  if (agent.agentType === "main") return MAIN_AGENT_COLOR;
  const key = agent.id || agent.slug || agent.displayType;
  if (key) return assignAgentColor(key);
  return UI.text.secondary;
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
