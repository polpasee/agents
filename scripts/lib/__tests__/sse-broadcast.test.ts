import { describe, it, expect, beforeEach } from "vitest";
import { viewers, broadcast, type SSEClient } from "../sse-broadcast";
import type { ServerEvent } from "../../../src/lib/types";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    send(data: string) { received.push(data); },
  };
}

describe("sse-broadcast", () => {
  beforeEach(() => {
    viewers.clear();
  });

  it("fans out a single event to every viewer", () => {
    const a = makeClient();
    const b = makeClient();
    viewers.add(a);
    viewers.add(b);

    const event: ServerEvent = { type: "state:remove", agentId: "main-x" };
    broadcast(event);

    const payload = JSON.stringify(event);
    expect(a.received).toEqual([payload]);
    expect(b.received).toEqual([payload]);
  });

  it("does not throw when there are no viewers", () => {
    expect(() => broadcast({ type: "state:remove", agentId: "x" })).not.toThrow();
  });

  it("isolates each viewer — a removed one does not receive later events", () => {
    const a = makeClient();
    const b = makeClient();
    viewers.add(a);
    viewers.add(b);

    broadcast({ type: "state:remove", agentId: "first" });
    viewers.delete(a);
    broadcast({ type: "state:remove", agentId: "second" });

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(2);
  });
});
