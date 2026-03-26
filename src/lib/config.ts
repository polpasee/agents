// ── Client-side configuration ─────────────────────────

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";
export const WS_RECONNECT_DELAY_MS = 2000;

export const ACTIVITY_MAX_ENTRIES = 100;
export const TOOL_CALLS_MAX_PER_AGENT = 20;
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** D3 force-directed graph layout parameters */
export const GRAPH = {
  nodeRadius: 22,
  glowRingRadius: 28,
  tokenBarWidth: 40,
  tokenBarHeight: 3,
  tokenBarY: 42,
  statusY: 54,
  tooltipY: -38,
  tooltipMaxWidth: 280,
  taskMaxChars: 36,
  linkDistance: 160,
  chargeStrength: -400,
  collideRadius: 60,
  zoomExtent: [0.15, 4] as [number, number],
  newNodeAlpha: 0.3,
  particleRadius: 3,
  particleSpeed: 1500,
  sparklineWidth: 40,
  sparklineHeight: 8,
  sparklineY: 62,
  sparklineBuckets: 10,
  sparklineBucketMs: 6000,
} as const;
