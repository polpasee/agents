import { describe, it, expect, beforeEach } from "vitest";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { viewers, type SSEClient } from "../../../../../scripts/lib/sse-broadcast";
import { DELETE } from "../[id]/route";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return { received, send(data: string) { received.push(data); } };
}

describe("/api/annotations/[id] DELETE", () => {
  beforeEach(() => {
    annotations.clear();
    viewers.clear();
  });

  it("removes an existing annotation, returns 204, and broadcasts annotation:update remove", async () => {
    annotations.set("ann-keep", {
      id: "ann-keep", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });
    const client = makeClient();
    viewers.add(client);

    const res = await DELETE(
      new Request("http://localhost/api/annotations/ann-keep", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ann-keep" }) },
    );

    expect(res.status).toBe(204);
    expect(annotations.has("ann-keep")).toBe(false);
    expect(client.received).toHaveLength(1);
    const broadcast = JSON.parse(client.received[0]);
    expect(broadcast.type).toBe("annotation:update");
    expect(broadcast.action).toBe("remove");
    expect(broadcast.annotation.id).toBe("ann-keep");
  });

  it("returns 404 when the annotation does not exist", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/annotations/ghost", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
