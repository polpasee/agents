// ── Client-side configuration ─────────────────────────

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";
export const WS_RECONNECT_DELAY_MS = 2000; // Initial delay before retrying a dropped WebSocket connection
export const WS_RECONNECT_MAX_DELAY_MS = 30000; // Upper bound for exponential backoff on reconnect attempts

export const ACTIVITY_MAX_ENTRIES = 100; // Max activity-log items kept in the UI before oldest are evicted
export const TOOL_CALLS_MAX_PER_AGENT = 20; // Max tool-call entries shown per agent in the detail panel
export const DEFAULT_CONTEXT_WINDOW = 1_000_000; // Fallback context-window size (tokens) when the model doesn't report one

/** D3 force-directed graph layout parameters */
export const GRAPH = {
  nodeRadius: 22, // Radius (px) of each agent node circle
  glowRingRadius: 28, // Radius (px) of the animated glow ring around active nodes
  activityCircleRadius: 58, // Radius (px) of the large activity circle when a tool is active
  activityMaxLines: 4, // Max text lines displayed inside the activity circle
  smallIconRadius: 22, // Radius (px) of the hex icon at right side of activity circle
  smallIconOffsetX: 52, // X offset (px) of the icon from circle center (right side)
  smallIconOffsetY: 10, // Y offset (px) of the icon from circle center
  tokenBarWidth: 40, // Width (px) of the token-usage progress bar beneath a node
  tokenBarHeight: 3, // Height (px) of the token-usage progress bar
  tokenBarY: 42, // Vertical offset (px) of the token bar relative to node center
  statusY: 54, // Vertical offset (px) of the status label below the node
  tooltipY: -38, // Vertical offset (px) of the hover tooltip above the node
  tooltipMaxWidth: 280, // Max width (px) of the tooltip before text wraps
  taskMaxChars: 36, // Max characters shown for a task name before truncation
  linkDistance: 200, // Ideal distance (px) between linked nodes in the force layout
  chargeStrength: -600, // Repulsive force strength; more negative = nodes push apart harder
  collideRadius: 60, // Collision radius (px) preventing node overlap
  zoomExtent: [0.15, 4] as [number, number], // Min and max zoom scale factors
  newNodeAlpha: 0.3, // Simulation alpha reheat value when a new node is added
  particleRadius: 3, // Radius (px) of message-flow particles traveling along links
  particleSpeed: 1500, // Duration (ms) for a particle to traverse a link
  sparklineWidth: 40, // Width (px) of the per-node sparkline chart
  sparklineHeight: 8, // Height (px) of the per-node sparkline chart
  sparklineY: 62, // Vertical offset (px) of the sparkline below the node center
  sparklineBuckets: 10, // Number of time buckets displayed in the sparkline
  sparklineBucketMs: 6000, // Duration (ms) each sparkline bucket covers
} as const;

/** Cost projection configuration */
export const COST_PROJECTION_WINDOW_MS = 60_000;
export const COST_WARNING_PERCENT = 80;
export const COST_CRITICAL_PERCENT = 95;

/** Heatmap overlay configuration */
export const HEATMAP = {
  legendWidth: 150,
  legendHeight: 12,
  legendPadding: 16,
  colors: ["#00ff88", "#eab308", "#ff4444"] as [string, string, string],
} as const;

/** F4: Live metrics configuration */
export const METRIC_HISTORY_MAX = 120; // 2 min at 1 sample/sec
export const METRIC_SAMPLE_INTERVAL_MS = 1000;
