// ── Server-side configuration ─────────────────────────

export const WS_PORT = Number(process.env.WS_PORT) || 4001;
export const POLL_INTERVAL_MS = 1500;

/** Mark agent as idle after this many ms without file writes */
export const STATUS_RUNNING_THRESHOLD_MS = 45_000;
/** Transition from running → idle (but keep visible) */
export const STATUS_IDLE_THRESHOLD_MS = 60_000;
/** Ignore JSONL files older than this */
export const DISCOVERY_THRESHOLD_MS = 30 * 60 * 1000;
/** Remove agents not modified for this long */
export const STALE_THRESHOLD_MS = 5 * 60 * 1000;
/** Purge removed agent IDs after this long (memory leak prevention) */
export const REMOVED_IDS_TTL_MS = 60 * 60 * 1000;

export const MAX_TOOL_CALLS_PER_AGENT = 20;
export const MAX_TASK_LENGTH = 100;
export const MAX_ARG_PREVIEW_LENGTH = 60;
export const INLINE_ARGS_MAX_KEYS = 2;
export const JSONL_MAX_BYTES = 16384;
