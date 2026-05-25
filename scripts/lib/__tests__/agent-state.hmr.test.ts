import { describe, it, expect } from "vitest";
import { agents, viewers } from "../agent-state";

describe("agent-state HMR survival", () => {
  it("shares the same Map instance across module re-imports via globalThis", async () => {
    agents.set("hmr-test", {
      id: "hmr-test",
      agentType: "main",
      status: "running",
      task: "x",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 0,
      startTime: 0,
    });

    // Re-import — should NOT be a fresh map
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error vitest supports ?bust=1 query suffix; tsc does not know this
    const reimport = await import("../agent-state?bust=1");
    expect(reimport.agents.has("hmr-test")).toBe(true);
    agents.delete("hmr-test");
  });

  it("viewers set is shared with sse-broadcast", async () => {
    const sse = await import("../sse-broadcast");
    expect(viewers).toBe(sse.viewers);
  });
});
