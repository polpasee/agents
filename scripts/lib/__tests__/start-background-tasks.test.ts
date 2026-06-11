import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted spy/state — vi.mock factories run before module imports, so we
// stash mutable references on a module-scope object that the factory closes
// over.
const state = {
  discoveryCalls: 0,
  discoveryShouldReject: false,
  webhookLoaded: 0,
};

vi.mock("../discovery", () => ({
  discoverActiveSessions: vi.fn(async () => {
    state.discoveryCalls += 1;
    if (state.discoveryShouldReject) throw new Error("discovery import path failure");
  }),
  refreshTrackedAgents: vi.fn(async () => {}),
  selectStaleAgentIds: vi.fn(() => []),
  selectLosingMains: vi.fn(() => []),
  isEphemeralProjectDir: vi.fn(() => false),
}));

vi.mock("../ccstatusline", () => ({
  readCacheMtime: vi.fn(() => Date.now()),
  triggerCcstatuslineRefresh: vi.fn(),
}));

vi.mock("../webhooks", () => ({
  loadWebhookConfig: vi.fn(() => { state.webhookLoaded += 1; }),
}));

import { startBackgroundTasks } from "../background-tasks";

const flagHolder = globalThis as { __backgroundTasksStarted?: boolean };

describe("startBackgroundTasks", () => {
  beforeEach(() => {
    state.discoveryCalls = 0;
    state.discoveryShouldReject = false;
    state.webhookLoaded = 0;
    // Reset the HMR-stable started flag by reaching into globalThis.
    flagHolder.__backgroundTasksStarted = false;

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    flagHolder.__backgroundTasksStarted = false;
  });

  it("invokes discovery exactly once on the first cycle (no duplicate cold-boot run)", async () => {
    await startBackgroundTasks();
    // pollLoop is invoked synchronously after await; the first
    // discoverActiveSessions call inside it is also synchronous up to its
    // first await. Yield a microtask so the inner await resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(state.discoveryCalls).toBe(1);
    expect(flagHolder.__backgroundTasksStarted).toBe(true);
  });

  it("leaves started flag false if a dynamic import / setup throws before pollLoop", async () => {
    // We can't easily force the dynamic import itself to reject from outside
    // the module, but we CAN force loadWebhookConfig (called synchronously
    // after imports resolve) to throw. The flag is flipped only AFTER all
    // setup completes, so a throw here must leave it false.
    const webhooks = await import("../webhooks");
    const loadSpy = vi.mocked(webhooks.loadWebhookConfig);
    loadSpy.mockImplementationOnce(() => { throw new Error("boom"); });

    await expect(startBackgroundTasks()).rejects.toThrow("boom");
    expect(flagHolder.__backgroundTasksStarted).toBe(false);
  });

  it("is a no-op when already started", async () => {
    await startBackgroundTasks();
    await Promise.resolve();
    await Promise.resolve();
    const callsAfterFirst = state.discoveryCalls;

    await startBackgroundTasks();
    // No additional discovery invocation triggered by the second call.
    expect(state.discoveryCalls).toBe(callsAfterFirst);
  });
});
