/**
 * Next.js instrumentation hook — runs once when the Next.js server boots
 * (both `next dev` and `next start`). We use it to kick off the JSONL
 * polling loop and the ccstatusline usage cache refresh.
 *
 * Located at src/instrumentation.ts (sibling to src/app/) per the
 * Next.js convention when using the src/ layout.
 */

// HMR-safe flag so we install the process-level error handlers exactly once
// even across dev hot-reloads (same globalThis pattern as agent-state.ts /
// background-tasks.ts).
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorErrHandlers: boolean | undefined;
}

export async function register(): Promise<void> {
  console.log("[instrumentation] register() called");

  // The state singleton uses Node-only APIs (fs, path). Guard so the edge
  // runtime instance — if Next ever spins one up — does not import them.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Last-resort visibility net for truly-unhandled errors. Poll loops already
  // catch their own errors locally; this only surfaces what would otherwise be
  // silent. Deliberately does NOT exit — this is a long-lived dev monitor.
  if (!globalThis.__agentMonitorErrHandlers) {
    globalThis.__agentMonitorErrHandlers = true;
    process.on("unhandledRejection", (reason) => {
      console.error("[instrumentation] unhandledRejection:", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("[instrumentation] uncaughtException:", err);
    });
  }

  const { startBackgroundTasks } =
    await import("../scripts/lib/background-tasks");
  await startBackgroundTasks();
}
