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

  // The state singleton uses Node-only APIs (fs, path). Guard so the edge
  // runtime instance — if Next ever spins one up — does not import them.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackgroundTasks } = await import("../scripts/lib/agent-state");
  await startBackgroundTasks();
}
