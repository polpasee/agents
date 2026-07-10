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
  // eslint-disable-next-line no-var
  var __agentMonitorErrHandlers: boolean | undefined;
}

export async function startBackgroundTasks(): Promise<void> {
  // Last-resort visibility net for truly-unhandled errors. Installed here — a
  // Node-only, dynamically-imported module — rather than in instrumentation.ts
  // so the `process.on` calls stay out of the edge bundle's static analysis.
  // Poll loops already catch their own errors locally; this only surfaces what
  // would otherwise be silent. Deliberately does NOT exit — long-lived monitor.
  // HMR-safe flag installs the handlers exactly once across dev hot-reloads.
  if (!globalThis.__agentMonitorErrHandlers) {
    globalThis.__agentMonitorErrHandlers = true;
    process.on("unhandledRejection", (reason) => {
      console.error("[instrumentation] unhandledRejection:", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("[instrumentation] uncaughtException:", err);
    });
  }

  if (globalThis.__backgroundTasksStarted) return;

  // Flip the started flag only AFTER all dynamic imports resolve. If any
  // import rejects, the flag stays false so a later caller can retry —
  // previously a failed import would permanently wedge polling off.
  const { discoverActiveSessions } = await import("./discovery");
  const { scanWorkflowsAllSessions } = await import("./main-session-discovery");
  const {
    PROJECTS_DIR,
    TEAMS_DIR,
    POLL_INTERVAL_MS,
    USAGE_REFRESH_INTERVAL_MS,
    USAGE_REFRESH_THRESHOLD_MS,
  } = await import("./config");
  const { discoverTeams } = await import("./teams-discovery");
  const { readCacheMtime, triggerCcstatuslineRefresh } =
    await import("./ccstatusline");
  const { loadWebhookConfig } = await import("./webhooks");

  loadWebhookConfig();

  console.log(`[bg] Agent Monitor background tasks starting`);
  console.log(`[bg] Watching: ${PROJECTS_DIR}`);
  console.log(`[bg] Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Escalate from warn to error once the residual scan has failed this many
  // times in a row, so a persistent outage is distinguishable from a one-off
  // hiccup buried in a stream of warns.
  const FAILURE_ESCALATION_THRESHOLD = 3;
  let pollFailures = 0;
  // Main/subagent lifecycle now arrives via push (hooks + OTLP); this loop only
  // drives the residuals push can't cover — workflow grouping and teams, both
  // read from disk. No more per-tick full/refresh discovery.
  async function pollLoop(): Promise<void> {
    try {
      await scanWorkflowsAllSessions(PROJECTS_DIR);
      await discoverTeams(TEAMS_DIR);
      pollFailures = 0;
    } catch (err) {
      pollFailures++;
      if (pollFailures >= FAILURE_ESCALATION_THRESHOLD) {
        console.error(
          `[bg poll] residual scan failing repeatedly (${pollFailures}x):`,
          err,
        );
      } else {
        console.warn("[bg poll] residual scan failed:", err);
      }
    } finally {
      setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  }

  let usageFailures = 0;
  async function usagePollLoop(): Promise<void> {
    try {
      const mtime = readCacheMtime();
      if (mtime === null || Date.now() - mtime > USAGE_REFRESH_THRESHOLD_MS) {
        triggerCcstatuslineRefresh();
      }
      usageFailures = 0;
    } catch (err) {
      usageFailures++;
      if (usageFailures >= FAILURE_ESCALATION_THRESHOLD) {
        console.error(
          `[bg usage] refresh failing repeatedly (${usageFailures}x):`,
          err,
        );
      } else {
        console.warn("[bg usage] refresh failed:", err);
      }
    } finally {
      setTimeout(usagePollLoop, USAGE_REFRESH_INTERVAL_MS);
    }
  }

  globalThis.__backgroundTasksStarted = true;

  // One-shot seed: push (hooks/OTLP) has no backfill, so a dashboard opened
  // mid-session would otherwise miss already-running agents until their next
  // event. Seed the currently-active sessions from disk once; the first push
  // event per node claims it (touch() drops its agentFilePaths entry) and push
  // owns its lifecycle thereafter. Seeded nodes never touched again age out via
  // normal pruning.
  try {
    await discoverActiveSessions(PROJECTS_DIR);
    console.log(`[bg] Seeded ${agents.size} active agent(s) from disk`);
  } catch (err) {
    console.warn("[bg] initial seed scan failed:", err);
  }

  pollLoop();
  usagePollLoop();
}
