import { describe, it, expect, beforeEach } from "vitest";
import { agents, edges, teams, viewers } from "../../../../../scripts/lib/agent-state";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../../scripts/lib/sse-broadcast";
import { GET } from "../route";

async function readFrames(body: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = "";

  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith(":")) continue; // keepalive comment
      if (raw.startsWith("data: ")) frames.push(raw.slice("data: ".length));
    }
  }
  // Release the reader lock without cancelling the stream, so callers can
  // still invoke res.body.cancel() to trigger the route's cancel hook.
  reader.releaseLock();
  return frames;
}

describe("/api/stream GET (SSE)", () => {
  beforeEach(() => {
    agents.clear();
    edges.length = 0;
    teams.clear();
    annotations.clear();
    viewers.clear();
  });

  it("returns text/event-stream and sends state:sync as the first frame", async () => {
    agents.set("main-x", {
      id: "main-x", agentType: "main", status: "running", task: "t",
      toolCalls: [], inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0,
    });

    const res = GET(new Request("http://localhost/api/stream"));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-store|no-cache/);

    const [first] = await readFrames(res.body!, 1);
    const event = JSON.parse(first);
    expect(event.type).toBe("state:sync");
    expect(event.agents).toHaveLength(1);
    expect(event.agents[0].id).toBe("main-x");
  });

  it("delivers a broadcast() to the connected viewer as a data frame", async () => {
    const res = GET(new Request("http://localhost/api/stream"));
    // Read state:sync first to fully open the stream
    const pre = readFrames(res.body!, 2);

    // Fire after viewer is added (next tick — the start() runs sync but
    // microtasks settle here)
    queueMicrotask(() => {
      broadcast({ type: "state:remove", agentId: "main-x" });
    });

    const frames = await pre;
    const remove = frames.find((f) => JSON.parse(f).type === "state:remove");
    expect(remove).toBeDefined();
  });

  it("registers a viewer in the viewers set during the stream lifecycle", async () => {
    expect(viewers.size).toBe(0);
    const res = GET(new Request("http://localhost/api/stream"));
    // First frame ensures start() has executed and viewer is added
    await readFrames(res.body!, 1);
    expect(viewers.size).toBe(1);
    await res.body!.cancel();
    // Allow microtask queue to flush the abort handler
    await new Promise((r) => setTimeout(r, 0));
    expect(viewers.size).toBe(0);
  });

  it("sends annotation:sync after state:sync when annotations exist", async () => {
    annotations.set("ann-pre", {
      id: "ann-pre", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });

    const res = GET(new Request("http://localhost/api/stream"));
    const [first, second] = await readFrames(res.body!, 2);
    expect(JSON.parse(first).type).toBe("state:sync");
    expect(JSON.parse(second).type).toBe("annotation:sync");
  });
});
