// ── Client-side configuration ─────────────────────────
// Live state stream is consumed via SSE (`/api/stream`); see
// useEventStream.ts. STREAM_BATCH_* constants below tune the client-side
// event-buffer flush cadence used to coalesce render churn.

export const STREAM_BATCH_INTERVAL_MS = 16; // Flush buffered state:update events ~1 frame
export const STREAM_BATCH_MAX_SIZE = 50; // Force-flush at this many buffered events

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
  linkDistance: 150, // Link distance (px) for Main↔Main edges (message/blocking/default)
  subAgentLinkDistance: 160, // Link distance (px) for Main↔sub-agent parent edges
  toolLinkDistance: 55, // Link distance (px) for any↔tool edges
  chargeDistanceMax: 320, // Cap (px) on charge reach — beyond this, charge contributes zero force (bounds main↔main drift)
  chargeStrengthMain: -260, // Repulsion strength applied to main agents (no parentId)
  chargeStrengthSubAgent: -150, // Repulsion strength applied to sub-agents (has parentId, not a tool)
  chargeStrengthTool: -55, // Repulsion strength applied to tool nodes
  centerStrength: 0.08, // Per-node strength for forceX/forceY pull toward viewport center
  parentLinkStrength: 0.85, // forceLink strength for parent (hierarchy) links — rigid so children cluster onto their parent
  peerLinkStrength: 0.08, // forceLink strength for message/blocking peer edges — cosmetic pull only, keeps them from distorting the tree
  toolLinkStrength: 0.7, // forceLink strength for tool links — tools hug their owning agent
  subAgentNodeRadius: 28, // Radius (px) of sub-agent nodes (agents with parentId, no teamId)
  depthScale: 0.85, // Per-level shrink factor for nested sub-agents at depth >= 2 (depth <= 1 stays at 1.0)
  depthScaleMin: 0.55, // Floor on the cumulative depth shrink so depth-5 nodes stay legible
  collideRadius: 120, // Padding (px) used for team-cluster hull/ellipse geometry — no longer fed into d3 forceCollide
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
  toolWindowMs: 15_000, // Duration (ms) tool call nodes remain visible after being called
  toolMaxPerAgent: 5, // Maximum number of tool nodes shown per agent at once
} as const;

/** Returns the effective node radius based on whether the agent is a sub-agent.
 *  `depthFactor` (see lib/d3/depth.ts) scales ONLY the sub-agent branch so
 *  nested sub-agents shrink per level; main agents and team members ignore it. */
export function getNodeRadius(
  agent: { parentId?: string | undefined; teamId?: string | undefined },
  depthFactor = 1,
): number {
  return agent.parentId && !agent.teamId
    ? GRAPH.subAgentNodeRadius * depthFactor
    : GRAPH.nodeRadius;
}

/** Cost projection configuration */
export const COST_PROJECTION_WINDOW_MS = 60_000;
export const COST_WARNING_PERCENT = 80;
export const COST_CRITICAL_PERCENT = 95;

/** Usage-bar thresholds (rate-limit/context %) — distinct from the cost-budget thresholds above. */
export const USAGE_WARNING_PERCENT = 60;
export const USAGE_CRITICAL_PERCENT = 85;

/** Heatmap overlay configuration */
export const HEATMAP = {
  legendWidth: 150,
  legendHeight: 12,
  legendPadding: 16,
  colors: ["#00ff88", "#eab308", "#ff4444"] as [string, string, string],
} as const;

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
