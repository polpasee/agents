import { describe, it, expect, beforeEach } from "vitest";
import { agents, agentLastModified, agentFilePaths } from "../../../../../../scripts/lib/agent-state";
import { HOOK_MAX_BODY_BYTES } from "../../../../../../scripts/lib/config";
import { POST } from "../route";

function post(body: unknown, origin?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("http://localhost/api/ingest/hook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  agents.clear();
  agentLastModified.clear();
  agentFilePaths.clear();
});

describe("/api/ingest/hook POST", () => {
  it("accepts a SessionStart (no Origin header) and registers the main", async () => {
    const res = await POST(
      post({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/p" }),
    );
    expect(res.status).toBe(200);
    expect(agents.get("s1")?.agentType).toBe("main");
  });

  it("returns 200 and no-ops for an unknown event", async () => {
    const res = await POST(post({ hook_event_name: "Nope", session_id: "s1" }));
    expect(res.status).toBe(200);
    expect(agents.size).toBe(0);
  });

  it("rejects a non-local Origin with 403", async () => {
    const res = await POST(
      post({ hook_event_name: "SessionStart", session_id: "s1" }, "http://evil.example.com"),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(post("{not json", "http://localhost"));
    expect(res.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds the cap", async () => {
    const req = new Request("http://localhost/api/ingest/hook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(HOOK_MAX_BODY_BYTES + 1),
      },
      body: JSON.stringify({ hook_event_name: "SessionStart" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});
