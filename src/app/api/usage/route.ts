import { NextResponse } from "next/server";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRequire } from "node:module";

/** ccstatusline writes fresh data here every ~3 minutes (it calls the Anthropic
 *  /api/oauth/usage endpoint and caches the response). This matches exactly
 *  what the terminal status line shows. */
const CCSTATUSLINE_CACHE = path.join(os.homedir(), ".cache", "ccstatusline", "usage.json");

/** Legacy fallback: Claude Code's own file. Older versions wrote it when
 *  rate-limit headers came back; newer versions have stopped writing it
 *  entirely, so it is usually stale or missing. */
const LEGACY_USAGE_PATH = path.join(os.homedir(), ".claude", "usage-status.json");

/** Mark the panel stale once data is older than this. ccstatusline's own
 *  cache window is 3 minutes, so an hour is a generous upper bound. */
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000;

/** Age at which we proactively fire ccstatusline in the background to refresh
 *  the cache. Matches ccstatusline's own CACHE_MAX_AGE (180s) so we only spawn
 *  when it would actually hit the upstream API. */
const REFRESH_THRESHOLD_MS = 180 * 1000;

/** Minimum gap between background refreshes. ccstatusline itself takes ~1–2s
 *  and the UI polls every 10s, so we throttle to avoid stacking spawns. */
const REFRESH_COOLDOWN_MS = 30 * 1000;

let lastRefreshAt = 0;

/** Resolve the path to the locally-installed ccstatusline binary.
 *  Uses fs.readFileSync rather than require() so Turbopack doesn't try to
 *  statically resolve the dynamic path at build time. */
function resolveCcstatuslineBin(): string {
  const _require = createRequire(import.meta.url);
  const ccPkgPath = _require.resolve("ccstatusline/package.json");
  const ccPkg = JSON.parse(fs.readFileSync(ccPkgPath, "utf8")) as { bin: Record<string, string> | string };
  const binRel = typeof ccPkg.bin === "string" ? ccPkg.bin : Object.values(ccPkg.bin)[0];
  return path.resolve(path.dirname(ccPkgPath), binRel);
}

/** Fire-and-forget ccstatusline invocation. Feeds it a minimal stdin payload
 *  so it renders a status line, which as a side effect refreshes usage.json. */
function triggerBackgroundRefresh() {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
  lastRefreshAt = now;
  try {
    const ccBin = resolveCcstatuslineBin();
    // Restrict env to prevent secret exfiltration if ccstatusline is ever compromised
    const child = spawn(process.execPath, [ccBin], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "production",
      },
    });
    child.on("error", () => {});
    const payload = JSON.stringify({
      workspace: { current_dir: process.cwd(), project_dir: process.cwd() },
      cost: { total_cost_usd: 0, total_duration_ms: 0, total_api_duration_ms: 0 },
      model: { display_name: "Opus 4.7" },
      session_id: "usage-refresh",
    });
    child.stdin?.end(payload);
    child.unref();
  } catch {
    // Spawn can fail if binary is missing — silently skip, caller still gets cache.
  }
}

export const dynamic = "force-dynamic";

interface UsagePayload {
  blockPercent: number | null;
  weeklyPercent: number | null;
  blockResetAt: string | null;
  weeklyResetAt: string | null;
  timestamp: number | null;
  ageMs: number | null;
  stale: boolean;
}

function readCcstatuslineCache(): UsagePayload | null {
  try {
    const stat = fs.statSync(CCSTATUSLINE_CACHE);
    const raw = fs.readFileSync(CCSTATUSLINE_CACHE, "utf-8");
    const data = JSON.parse(raw);
    if (data?.sessionUsage == null && data?.weeklyUsage == null) return null;
    const timestamp = stat.mtimeMs;
    const ageMs = Date.now() - timestamp;
    return {
      blockPercent: data.sessionUsage ?? null,
      weeklyPercent: data.weeklyUsage ?? null,
      blockResetAt: data.sessionResetAt ?? null,
      weeklyResetAt: data.weeklyResetAt ?? null,
      timestamp,
      ageMs,
      stale: ageMs > STALENESS_THRESHOLD_MS,
    };
  } catch {
    return null;
  }
}

function readLegacyUsage(): UsagePayload | null {
  try {
    const raw = fs.readFileSync(LEGACY_USAGE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!data) return null;

    // resets_at from Claude Code is Unix seconds — convert to ISO string
    const blockResetAt = typeof data.blockResetAt === "number"
      ? new Date(data.blockResetAt * 1000).toISOString()
      : data.blockResetAt ?? null;
    const weeklyResetAt = typeof data.weeklyResetAt === "number"
      ? new Date(data.weeklyResetAt * 1000).toISOString()
      : data.weeklyResetAt ?? null;

    const timestamp: number | null = typeof data.timestamp === "number" ? data.timestamp : null;
    const ageMs = timestamp != null ? Date.now() - timestamp : null;
    const stale = ageMs != null ? ageMs > STALENESS_THRESHOLD_MS : true;

    return {
      blockPercent: data.blockPercent ?? null,
      weeklyPercent: data.weeklyPercent ?? null,
      blockResetAt,
      weeklyResetAt,
      timestamp,
      ageMs,
      stale,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const payload = readCcstatuslineCache() ?? readLegacyUsage();
  if (payload?.ageMs != null && payload.ageMs > REFRESH_THRESHOLD_MS) {
    triggerBackgroundRefresh();
  }
  return NextResponse.json(payload);
}
