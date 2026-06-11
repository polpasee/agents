// ── Background tasks ─────────────────────────────────
// Polling cadence and usage cache refresh were previously owned by the
// stand-alone ws-server process. After the SSE migration they run inside
// the Next.js process, started exactly once by src/instrumentation.ts.

import * as path from "node:path";
import * as os from "node:os";
import { agents, _backgroundStarted, _markBackgroundStarted } from "./agent-state";

export async function startBackgroundTasks(): Promise<void> {
  if (_backgroundStarted()) return;

  // Flip the started flag only AFTER all dynamic imports resolve. If any
  // import rejects, the flag stays false so a later caller can retry —
  // previously a failed import would permanently wedge polling off.
  const { discoverActiveSessions, refreshTrackedAgents } = await import("./discovery");
  const { POLL_INTERVAL_MS, USAGE_REFRESH_INTERVAL_MS, USAGE_REFRESH_THRESHOLD_MS, FULL_SCAN_EVERY_N_POLLS } = await import("./config");
  const { readCacheMtime, triggerCcstatuslineRefresh } = await import("./ccstatusline");
  const { loadWebhookConfig } = await import("./webhooks");

  const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

  loadWebhookConfig();

  console.log(`[bg] Agent Monitor background tasks starting`);
  console.log(`[bg] Watching: ${PROJECTS_DIR}`);
  console.log(`[bg] Poll interval: ${POLL_INTERVAL_MS}ms`);

  let firstRun = true;
  let pollTick = 0;
  async function pollLoop(): Promise<void> {
    try {
      // Every Nth tick does a full filesystem rediscovery (picks up new
      // sessions); the rest just refresh already-tracked agents, avoiding a
      // stat() over every historical JSONL file on every tick. Tick 0 is a
      // full scan so the first cycle is a complete cold-boot discovery.
      if (pollTick % FULL_SCAN_EVERY_N_POLLS === 0) {
        await discoverActiveSessions(PROJECTS_DIR);
      } else {
        await refreshTrackedAgents();
      }
      if (firstRun) {
        firstRun = false;
        console.log(`[bg] Found ${agents.size} active agent(s)`);
      }
    } catch (err) {
      console.warn("[bg poll] discovery failed:", err);
    } finally {
      pollTick++;
      setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  }

  async function usagePollLoop(): Promise<void> {
    try {
      const mtime = readCacheMtime();
      if (mtime === null || Date.now() - mtime > USAGE_REFRESH_THRESHOLD_MS) {
        triggerCcstatuslineRefresh();
      }
    } catch (err) {
      console.warn("[bg usage] refresh failed:", err);
    } finally {
      setTimeout(usagePollLoop, USAGE_REFRESH_INTERVAL_MS);
    }
  }

  _markBackgroundStarted();
  pollLoop();
  usagePollLoop();
}
