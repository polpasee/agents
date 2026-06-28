/**
 * Next.js instrumentation hook — runs once when the Next.js server boots
 * (both `next dev` and `next start`). We use it to kick off the JSONL
 * polling loop and the ccstatusline usage cache refresh.
 *
 * Located at src/instrumentation.ts (sibling to src/app/) per the
 * Next.js convention when using the src/ layout.
 */

export async function register(): Promise<void> {
  console.log("[instrumentation] register() called");

  // The background tasks use Node-only APIs (fs, path, process). Guard so the
  // edge runtime instance — if Next ever spins one up — does not run them.
  // The dynamic import below is also what keeps Node APIs out of the edge
  // bundle: Next's edge analyzer is lexical and does not trace into import(),
  // so all process-level code (error handlers included) lives behind it.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startBackgroundTasks } =
    await import("../scripts/lib/background-tasks");
  await startBackgroundTasks();
}
