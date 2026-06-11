// Shared ccstatusline spawn helper.
//
// ccstatusline writes its cache file at ~/.cache/ccstatusline/usage.json every
// time it renders a status line (it calls the Anthropic /api/oauth/usage
// endpoint and caches the response for ~3 minutes). To refresh the cache we
// spawn the binary with a minimal stdin payload — the cache write is the
// useful side effect.
//
// This module is imported only by the startBackgroundTasks usage poll loop
// (the long-running loop that owns refresh cadence). `src/app/api/usage/
// route.ts` reads the cache path from scripts/lib/config instead, keeping
// this spawn helper out of the pure cache-reader route's import graph.
//
// Sprint 1 hardening retained: pinned local binary resolution and a strictly
// filtered env so a compromised ccstatusline cannot exfiltrate ambient secrets.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { CCSTATUSLINE_CACHE } from "./config";

/** Resolve the pinned, locally-installed ccstatusline binary path. */
function resolveCcstatuslineBin(): string {
  const _require = createRequire(import.meta.url);
  const ccPkgPath = _require.resolve("ccstatusline/package.json");
  const ccPkg = JSON.parse(fs.readFileSync(ccPkgPath, "utf8")) as { bin: Record<string, string> | string };
  const binRel = typeof ccPkg.bin === "string" ? ccPkg.bin : Object.values(ccPkg.bin)[0];
  return path.resolve(path.dirname(ccPkgPath), binRel);
}

/** Fire-and-forget spawn that refreshes the ccstatusline cache. Returns true
 *  if a child was spawned, false if resolving the binary failed. The caller
 *  owns refresh cadence — no internal cooldown. */
export function triggerCcstatuslineRefresh(): boolean {
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
    return true;
  } catch {
    return false;
  }
}

/** Cache-file mtime (ms) or null if missing. */
export function readCacheMtime(): number | null {
  try {
    return fs.statSync(CCSTATUSLINE_CACHE).mtimeMs;
  } catch {
    return null;
  }
}
