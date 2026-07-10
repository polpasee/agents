import { describe, it, expect, beforeEach } from "vitest";
import {
  touch,
  setPushStatus,
  addTokens,
  flushPendingTokens,
  resetPendingTokensForTest,
} from "../push-ingest";
import {
  agents,
  agentLastModified,
  agentFilePaths,
  viewers,
} from "../agent-state";
import type { SSEClient } from "../sse-broadcast";
import { mockAgent } from "../../../src/lib/__tests__/test-utils";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    send(data: string) {
      received.push(data);
    },
  };
}

beforeEach(() => {
  agents.clear();
  agentLastModified.clear();
  agentFilePaths.clear();
  viewers.clear();
  resetPendingTokensForTest();
});

describe("touch", () => {
  it("sets agentLastModified and clears agentFilePaths (claims a fileless node)", () => {
    agentFilePaths.set("a1", "/some/file.jsonl");
    touch("a1", 1000);
    expect(agentLastModified.get("a1")).toBe(1000);
    expect(agentFilePaths.has("a1")).toBe(false);
  });

  it("keeps the max of the previous and new timestamp", () => {
    touch("a1", 2000);
    touch("a1", 1000);
    expect(agentLastModified.get("a1")).toBe(2000);
  });
});

describe("setPushStatus", () => {
  it("no-ops when the node isn't registered", () => {
    expect(() => setPushStatus("missing", "running", 1000)).not.toThrow();
    expect(agents.has("missing")).toBe(false);
    // touch still happens even though the mutation is skipped
    expect(agentLastModified.get("missing")).toBe(1000);
  });

  it("transitions to a non-completed status and broadcasts agent:status", () => {
    agents.set("a1", mockAgent({ id: "a1", status: "running" }));
    const client = makeClient();
    viewers.add(client);

    setPushStatus("a1", "waiting", 1500, { waitingOn: "a2" });

    expect(agents.get("a1")?.status).toBe("waiting");
    expect(agents.get("a1")?.waitingOn).toBe("a2");
    expect(client.received).toHaveLength(1);
    const msg = JSON.parse(client.received[0]!);
    expect(msg.event.type).toBe("agent:status");
    expect(msg.event.status).toBe("waiting");
    expect(msg.event.waitingOn).toBe("a2");
  });

  it("transitions to completed and broadcasts agent:complete with duration/summary", () => {
    agents.set("a1", mockAgent({ id: "a1", status: "running" }));
    const client = makeClient();
    viewers.add(client);

    setPushStatus("a1", "completed", 5000, {
      duration: 4000,
      summary: "did the thing",
    });

    expect(agents.get("a1")?.status).toBe("completed");
    expect(agents.get("a1")?.duration).toBe(4000);
    expect(agents.get("a1")?.summary).toBe("did the thing");
    const msg = JSON.parse(client.received[0]!);
    expect(msg.event.type).toBe("agent:complete");
    expect(msg.event.duration).toBe(4000);
    expect(msg.event.summary).toBe("did the thing");
  });

  it("Stop transition to idle does NOT broadcast agent:complete", () => {
    agents.set("a1", mockAgent({ id: "a1", status: "running" }));
    const client = makeClient();
    viewers.add(client);

    setPushStatus("a1", "idle", 2000);

    const msg = JSON.parse(client.received[0]!);
    expect(msg.event.type).toBe("agent:status");
    expect(msg.event.status).toBe("idle");
  });

  it("also claims the node (agentFilePaths cleared)", () => {
    agents.set("a1", mockAgent({ id: "a1" }));
    agentFilePaths.set("a1", "/f.jsonl");
    setPushStatus("a1", "running", 1000);
    expect(agentFilePaths.has("a1")).toBe(false);
  });
});

describe("addTokens", () => {
  it("accumulates onto an existing node and broadcasts running totals", () => {
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    );
    const client = makeClient();
    viewers.add(client);

    addTokens("a1", { input: 100, output: 50, cacheRead: 1, cacheCreate: 2 });

    const agent = agents.get("a1")!;
    expect(agent.inputTokens).toBe(110);
    expect(agent.outputTokens).toBe(55);
    expect(agent.cacheReadTokens).toBe(1);
    expect(agent.cacheCreateTokens).toBe(2);

    const msg = JSON.parse(client.received[0]!);
    expect(msg.event.type).toBe("agent:tokens");
    expect(msg.event.inputTokens).toBe(110);
    expect(msg.event.outputTokens).toBe(55);
  });

  it("updates contextWindow when provided", () => {
    agents.set("a1", mockAgent({ id: "a1", contextWindow: 200000 }));
    addTokens("a1", { input: 1 }, 500000);
    expect(agents.get("a1")?.contextWindow).toBe(500000);
  });

  it("touches (claims) the node on every call", () => {
    agents.set("a1", mockAgent({ id: "a1" }));
    agentFilePaths.set("a1", "/f.jsonl");
    addTokens("a1", { input: 1 });
    expect(agentFilePaths.has("a1")).toBe(false);
    expect(agentLastModified.get("a1")).toBeGreaterThan(0);
  });

  it("buffers deltas for a node that doesn't exist yet, without throwing or broadcasting", () => {
    const client = makeClient();
    viewers.add(client);

    addTokens("unregistered-1", { input: 10, output: 20 });

    expect(client.received).toHaveLength(0);
    expect(agents.has("unregistered-1")).toBe(false);
  });

  it("accumulates multiple buffered deltas before the node registers", () => {
    addTokens("unregistered-2", { input: 10, output: 5 });
    addTokens("unregistered-2", { input: 3, cacheRead: 1 });

    agents.set(
      "unregistered-2",
      mockAgent({
        id: "unregistered-2",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    );
    flushPendingTokens("unregistered-2");

    const agent = agents.get("unregistered-2")!;
    expect(agent.inputTokens).toBe(13);
    expect(agent.outputTokens).toBe(5);
    expect(agent.cacheReadTokens).toBe(1);
  });
});

describe("flushPendingTokens", () => {
  it("is a no-op when nothing is buffered for the id", () => {
    agents.set("a1", mockAgent({ id: "a1", inputTokens: 5 }));
    expect(() => flushPendingTokens("a1")).not.toThrow();
    expect(agents.get("a1")?.inputTokens).toBe(5);
  });

  it("flushes buffered deltas exactly once (does not double count on a second flush)", () => {
    addTokens("a1", { input: 42 });
    agents.set("a1", mockAgent({ id: "a1", inputTokens: 0 }));

    flushPendingTokens("a1");
    expect(agents.get("a1")?.inputTokens).toBe(42);

    flushPendingTokens("a1");
    expect(agents.get("a1")?.inputTokens).toBe(42);
  });

  it("carries the buffered contextWindow through to the flushed update", () => {
    addTokens("a1", { input: 1 }, 999999);
    agents.set("a1", mockAgent({ id: "a1", contextWindow: 1 }));
    flushPendingTokens("a1");
    expect(agents.get("a1")?.contextWindow).toBe(999999);
  });
});

describe("pending-token buffer cap", () => {
  it("evicts the oldest buffered id once the cap is exceeded", () => {
    // Cap is 200 — fill past it with distinct unregistered ids, then verify
    // the very first one was evicted while a later one survives.
    for (let i = 0; i < 205; i++) {
      addTokens(`pending-${i}`, { input: 1 });
    }
    agents.set("pending-0", mockAgent({ id: "pending-0", inputTokens: 0 }));
    agents.set("pending-204", mockAgent({ id: "pending-204", inputTokens: 0 }));

    flushPendingTokens("pending-0");
    flushPendingTokens("pending-204");

    // Evicted entry's buffered delta is gone — flush is a no-op, so the
    // agent's own baseline (0) stands.
    expect(agents.get("pending-0")?.inputTokens).toBe(0);
    // The most recent entry survived the cap and flushes normally.
    expect(agents.get("pending-204")?.inputTokens).toBe(1);
  });
});
