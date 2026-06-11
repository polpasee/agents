// ── Server-side configuration ─────────────────────────

import * as os from "node:os";
import * as path from "node:path";

/** The durable record of every Claude Code session — discovery, cost
 *  history, and mock seeding all operate under here. Kept hard-coded
 *  (not env-driven); consumers tolerate a missing dir. */
export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export const POLL_INTERVAL_MS = 1500;

/** Full filesystem rediscovery (scan every project dir for *new* sessions)
 *  runs once every Nth poll; the other ticks only refresh agents we already
 *  track. This keeps live token/tool/status updates at POLL_INTERVAL_MS while
 *  avoiding a stat() over every historical JSONL file on every tick — the
 *  dominant poll-loop cost. 4 → a full scan roughly every 6s at 1500ms. */
export const FULL_SCAN_EVERY_N_POLLS = 4;

/** Hard cap on stored annotations — evict oldest beyond this */
export const ANNOTATION_MAX_ENTRIES = 500;
export const ANNOTATION_MAX_TEXT_LENGTH = 1024;
export const ANNOTATION_ID_PATTERN = /^ann-[A-Za-z0-9_-]{1,48}$/;
/** Reject POST /api/annotations bodies larger than this (DoS guard). A valid
 *  payload is ~1KB; 8KB leaves 7× headroom for author/coords/whitespace. */
export const ANNOTATION_MAX_BODY_BYTES = 8 * 1024;

/** Hard cap on agent log file size — refuse to read larger */
export const LOG_READ_MAX_BYTES = 10 * 1024 * 1024;

/** Agent is considered still-running if file modified within this window */
export const STATUS_RUNNING_THRESHOLD_MS = 45_000;
/** Agent transitions to idle if file modified between RUNNING and this threshold */
export const STATUS_IDLE_THRESHOLD_MS = 60_000;
/** Ignore JSONL files older than this */
export const DISCOVERY_THRESHOLD_MS = 30 * 60 * 1000;
/** Remove agents not modified for this long. Short enough that a closed
 *  Claude Code session fades from the topology within ~10 minutes; long
 *  enough that a user writing a long prompt doesn't disappear mid-type.
 *  Main sessions with active sub-agents are separately protected in
 *  discovery.ts::selectStaleAgentIds so long background tools (e.g. a
 *  30-minute `npm test` driven by a sub-agent) don't purge the main. */
export const STALE_THRESHOLD_MS = 10 * 60 * 1000;
/** Sub-agents (those with a parentId) are purged sooner when idle */
export const SUBAGENT_STALE_THRESHOLD_MS = 60_000;
/** Purge removed agent IDs after this long (memory leak prevention) */
export const REMOVED_IDS_TTL_MS = 60 * 60 * 1000;

export const MAX_TOOL_CALLS_PER_AGENT = 20;
export const MAX_TASK_LENGTH = 100;
export const MAX_ARG_PREVIEW_LENGTH = 60;
export const INLINE_ARGS_MAX_KEYS = 2;
export const JSONL_MAX_BYTES = 16384;

/** ── Usage cache refresh (startBackgroundTasks-owned) ─────────────
 *  The startBackgroundTasks usage poll loop checks the ccstatusline cache file
 *  mtime on this interval and fires a refresh spawn if the cache is older than
 *  USAGE_REFRESH_THRESHOLD_MS. Owning refresh cadence there (vs. the HTTP
 *  route) makes the GET handler pure and removes a TOCTOU race between
 *  concurrent requests. */
export const USAGE_REFRESH_INTERVAL_MS = 30 * 1000;
/** Spawn ccstatusline when the cache is older than this. Matches ccstatusline's
 *  own internal CACHE_MAX_AGE (180s) so a refresh actually round-trips to the API. */
export const USAGE_REFRESH_THRESHOLD_MS = 180 * 1000;
/** ccstatusline writes fresh usage data here every ~3 minutes. Lives in config
 *  (not the spawn helper) so pure cache readers like src/app/api/usage/route.ts
 *  can import the path without pulling in node:child_process. */
export const CCSTATUSLINE_CACHE = path.join(os.homedir(), ".cache", "ccstatusline", "usage.json");
