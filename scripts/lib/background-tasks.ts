// ── Background tasks ─────────────────────────────────
// Polling cadence and usage cache refresh were previously owned by the
// stand-alone ws-server process. After the SSE migration they run inside
// the Next.js process, started exactly once by src/instrumentation.ts.

import { agents } from "./agent-state";

// ── HMR-safe start-once flag ─────────────────────────
// Stashed on globalThis (same pattern as agent-state's store) so Next.js dev
// hot-reloads cannot start a second set of polling loops.
declare global {
  // eslint-disable-next-line no-var
  var __backgroundTasksStarted: boolean | undefined;
}

export async function startBackgroundTasks(): Promise<void> {
  if (globalThis.__backgroundTasksStarted) return;

  // Flip the started flag only AFTER all dynamic imports resolve. If any
  // import rejects, the flag stays false so a later caller can retry —
  // previously a failed import would permanently wedge polling off.
  const { discoverActiveSessions, refreshTrackedAgents } = await import("./discovery");
  const { PROJECTS_DIR, TEAMS_DIR, POLL_INTERVAL_MS, USAGE_REFRESH_INTERVAL_MS, USAGE_REFRESH_THRESHOLD_MS, FULL_SCAN_EVERY_N_POLLS } = await import("./config");
  const { discoverTeams } = await import("./teams-discovery");
  const { readCacheMtime, triggerCcstatuslineRefresh } = await import("./ccstatusline");
  const { loadWebhookConfig } = await import("./webhooks");

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
      await discoverTeams(TEAMS_DIR);
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

  globalThis.__backgroundTasksStarted = true;
  pollLoop();
  usagePollLoop();
}
