import { describe, it, expect, beforeEach } from "vitest";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import {
  viewers,
  type SSEClient,
} from "../../../../../scripts/lib/sse-broadcast";
import { DELETE } from "../[id]/route";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    send(data: string) {
      received.push(data);
    },
  };
}

describe("/api/annotations/[id] DELETE", () => {
  beforeEach(() => {
    annotations.clear();
    viewers.clear();
  });

  it("removes an existing annotation, returns 204, and broadcasts annotation:update remove", async () => {
    annotations.set("ann-keep", {
      id: "ann-keep",
      targetId: "x",
      targetType: "agent",
      text: "y",
      timestamp: 1,
    });
    const client = makeClient();
    viewers.add(client);

    const res = await DELETE(
      new Request("http://localhost/api/annotations/ann-keep", {
        method: "DELETE",
        // A present, allowlisted Origin is required on mutating routes.
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id: "ann-keep" }) },
    );

    expect(res.status).toBe(204);
    expect(annotations.has("ann-keep")).toBe(false);
    expect(client.received).toHaveLength(1);
    // safe: toHaveLength(1) asserts exactly one element was pushed
    const broadcast = JSON.parse(client.received[0]!);
    expect(broadcast.type).toBe("annotation:update");
    expect(broadcast.action).toBe("remove");
    expect(broadcast.annotation.id).toBe("ann-keep");
  });

  it("returns 404 when the annotation does not exist", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/annotations/ghost", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when the Origin header is absent (CSRF guard)", async () => {
    annotations.set("ann-keep", {
      id: "ann-keep",
      targetId: "x",
      targetType: "agent",
      text: "y",
      timestamp: 1,
    });
    const res = await DELETE(
      new Request("http://localhost/api/annotations/ann-keep", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "ann-keep" }) },
    );
    expect(res.status).toBe(403);
    // The guard runs before deletion, so the annotation survives.
    expect(annotations.has("ann-keep")).toBe(true);
  });
});
