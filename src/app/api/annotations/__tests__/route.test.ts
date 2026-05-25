import { describe, it, expect, beforeEach } from "vitest";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { viewers, type SSEClient } from "../../../../../scripts/lib/sse-broadcast";
import {
  ANNOTATION_MAX_ENTRIES,
  ANNOTATION_MAX_BODY_BYTES,
} from "../../../../../scripts/lib/config";

import { POST } from "../route";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return { received, send(data: string) { received.push(data); } };
}

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/annotations POST", () => {
  beforeEach(() => {
    annotations.clear();
    viewers.clear();
  });

  it("creates a valid annotation, returns 201, and broadcasts annotation:update add", async () => {
    const client = makeClient();
    viewers.add(client);

    const res = await POST(postBody({
      id: "ann-abc123",
      targetId: "main-x",
      targetType: "agent",
      text: "hello",
      timestamp: 1700000000000,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.annotation.id).toBe("ann-abc123");
    expect(annotations.size).toBe(1);
    expect(client.received).toHaveLength(1);
    const broadcast = JSON.parse(client.received[0]);
    expect(broadcast.type).toBe("annotation:update");
    expect(broadcast.action).toBe("add");
    expect(broadcast.annotation.id).toBe("ann-abc123");
  });

  it("returns 400 on malformed input (bad id pattern)", async () => {
    const res = await POST(postBody({
      id: "bad", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 409 on duplicate id", async () => {
    annotations.set("ann-existing", {
      id: "ann-existing", targetId: "x", targetType: "agent", text: "old", timestamp: 1,
    });
    const res = await POST(postBody({
      id: "ann-existing", targetId: "x", targetType: "agent", text: "new", timestamp: 2,
    }));
    expect(res.status).toBe(409);
  });

  it("evicts oldest when over cap", async () => {
    for (let i = 0; i < ANNOTATION_MAX_ENTRIES; i++) {
      annotations.set(`ann-fill${i}`, {
        id: `ann-fill${i}`, targetId: "x", targetType: "agent", text: "y", timestamp: i,
      });
    }
    expect(annotations.size).toBe(ANNOTATION_MAX_ENTRIES);

    const res = await POST(postBody({
      id: "ann-newest", targetId: "x", targetType: "agent", text: "z", timestamp: 999999,
    }));
    expect(res.status).toBe(201);
    expect(annotations.size).toBe(ANNOTATION_MAX_ENTRIES);
    expect(annotations.has("ann-fill0")).toBe(false);
    expect(annotations.has("ann-newest")).toBe(true);
  });

  it("broadcasts annotation:update remove for each LRU-evicted entry", async () => {
    for (let i = 0; i < ANNOTATION_MAX_ENTRIES; i++) {
      annotations.set(`ann-fill${i}`, {
        id: `ann-fill${i}`, targetId: "x", targetType: "agent", text: "y", timestamp: i,
      });
    }
    const client = makeClient();
    viewers.add(client);

    const res = await POST(postBody({
      id: "ann-newest", targetId: "x", targetType: "agent", text: "z", timestamp: 999999,
    }));
    expect(res.status).toBe(201);

    const events = client.received.map((s) => JSON.parse(s));
    const remove = events.find(
      (e) => e.type === "annotation:update" && e.action === "remove",
    );
    expect(remove).toBeDefined();
    expect(remove.annotation.id).toBe("ann-fill0");

    const add = events.find(
      (e) => e.type === "annotation:update" && e.action === "add",
    );
    expect(add).toBeDefined();
    expect(add.annotation.id).toBe("ann-newest");
  });

  it("returns 413 when Content-Length exceeds the body cap", async () => {
    const big = "x".repeat(ANNOTATION_MAX_BODY_BYTES + 100);
    const req = new Request("http://localhost/api/annotations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(big.length + 32),
      },
      body: JSON.stringify({
        id: "ann-toobig", targetId: "x", targetType: "agent", text: big, timestamp: 1,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 413 when body byteLength exceeds cap (no Content-Length header)", async () => {
    // Simulate a missing/incorrect Content-Length: even then, the route must
    // cap based on actual buffer size before parsing.
    const big = "x".repeat(ANNOTATION_MAX_BODY_BYTES + 100);
    const body = JSON.stringify({
      id: "ann-toobig", targetId: "x", targetType: "agent", text: big, timestamp: 1,
    });
    // Pass a ReadableStream so Content-Length is not auto-set.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const req = new Request("http://localhost/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // @ts-expect-error duplex is required by undici for streamed bodies but
      // is not in the RequestInit lib types yet.
      duplex: "half",
      body: stream,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request("http://localhost/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
