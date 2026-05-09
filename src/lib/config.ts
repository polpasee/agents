// ── Client-side configuration ─────────────────────────

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";
export const WS_RECONNECT_DELAY_MS = 2000; // Initial delay before retrying a dropped WebSocket connection
export const WS_RECONNECT_MAX_DELAY_MS = 30000; // Upper bound for exponential backoff on reconnect attempts
export const WS_BATCH_INTERVAL_MS = 16; // Flush buffered state:update events every ~1 frame (16ms)
export const WS_BATCH_MAX_SIZE = 50; // Force-flush the buffer if it reaches this many events

export const ACTIVITY_MAX_ENTRIES = 100; // Max activity-log items kept in the UI before oldest are evicted
export const TOOL_CALLS_MAX_PER_AGENT = 20; // Max tool-call entries shown per agent in the detail panel
export const DEFAULT_CONTEXT_WINDOW = 1_000_000; // Fallback context-window size (tokens) when the model doesn't report one

/** D3 force-directed graph layout parameters */
export const GRAPH = {
  nodeRadius: 42, // Radius (px) of each agent node circle
  glowRingRadius: 50, // Radius (px) of the animated glow ring around active nodes
  activityCircleRadius: 72, // Radius (px) of the large activity circle when a tool is active
  activityMaxLines: 5, // Max text lines displayed inside the activity circle
  smallIconRadius: 28, // Radius (px) of the hex icon at right side of activity circle
  smallIconOffsetX: 62, // X offset (px) of the icon from circle center (right side)
  smallIconOffsetY: 12, // Y offset (px) of the icon from circle center
  tokenBarWidth: 50, // Width (px) of the token-usage progress bar beneath a node
  tokenBarHeight: 4, // Height (px) of the token-usage progress bar
  tokenBarY: 58, // Vertical offset (px) of the token bar relative to node center
  statusY: 72, // Vertical offset (px) of the status label below the node
  tooltipY: -48, // Vertical offset (px) of the hover tooltip above the node
  tooltipMaxWidth: 280, // Max width (px) of the tooltip before text wraps
  taskMaxChars: 36, // Max characters shown for a task name before truncation
  linkDistance: 360, // Ideal distance (px) between linked nodes in the force layout
  subAgentLinkDistance: 160, // Default distance (px) between a parent and a sub-agent — also used when a non-team sub-agent has live tool nodes
  subAgentLinkDistanceCompact: 80, // Tighter distance (px) for non-team sub-agents with no tool nodes — pulls them close to their parent
  subAgentChargeCompactScale: 0.35, // Charge-strength multiplier for non-team sub-agents with no tool nodes so they cluster near the parent
  chargeStrength: -1200, // Repulsive force strength; more negative = nodes push apart harder
  subAgentNodeRadius: 28, // Radius (px) of sub-agent nodes (agents with parentId, no teamId)
  subAgentCollideRadius: 70, // Collision radius (px) for sub-agent nodes
  collideRadius: 120, // Collision radius (px) preventing node overlap
  zoomExtent: [0.15, 4] as [number, number], // Min and max zoom scale factors
  newNodeAlpha: 0.3, // Simulation alpha reheat value when a new node is added
  particleRadius: 3, // Radius (px) of message-flow particles traveling along links
  particleSpeed: 1500, // Duration (ms) for a particle to traverse a link
  sparklineWidth: 50, // Width (px) of the per-node sparkline chart
  sparklineHeight: 10, // Height (px) of the per-node sparkline chart
  sparklineY: 100, // Vertical offset (px) of the sparkline below the node center (must sit below the stats line at statusY+18)
  sparklineBuckets: 10, // Number of time buckets displayed in the sparkline
  sparklineBucketMs: 6000, // Duration (ms) each sparkline bucket covers
  toolNodeRadius: 14, // Radius (px) of tool call nodes in the force graph
  toolLinkDistance: 80, // Ideal distance (px) between a tool node and its parent agent
  toolWindowMs: 15_000, // Duration (ms) tool call nodes remain visible after being called
  toolMaxPerAgent: 5, // Maximum number of tool nodes shown per agent at once
} as const;

/** Returns the effective node radius based on whether the agent is a sub-agent */
export function getNodeRadius(agent: { parentId?: string; teamId?: string }): number {
  return agent.parentId && !agent.teamId ? GRAPH.subAgentNodeRadius : GRAPH.nodeRadius;
}

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

/** Idle agent timeout — agents idle longer than this are hidden from the graph */
export const IDLE_TIMEOUT_MS = 60_000;

/** Replay tick interval — how often the replay clock advances */
export const REPLAY_TICK_MS = 50;

/** Cap on the in-memory recording buffer to prevent OOM during long sessions.
 *  At ~20 events/sec sustained that's ~40 minutes of recording before the
 *  oldest entries start dropping. Documented in README "Session Recording &
 *  Replay". */
export const RECORDING_MAX_EVENTS = 50_000;

/** F4: Live metrics configuration */
export const METRIC_HISTORY_MAX = 120; // 2 min at 1 sample/sec
export const METRIC_SAMPLE_INTERVAL_MS = 1000;
