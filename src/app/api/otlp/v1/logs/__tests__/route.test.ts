import { describe, it, expect, beforeEach } from "vitest";
import { agents, agentLastModified } from "../../../../../../../scripts/lib/agent-state";
import { resetSeenRequestsForTest } from "../../../../../../../scripts/lib/otlp-ingest";
import { OTLP_MAX_BODY_BYTES } from "../../../../../../../scripts/lib/config";
import { mockAgent } from "../../../../../../../src/lib/__tests__/test-utils";
import { POST } from "../route";

function post(body: unknown, origin?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("http://localhost/api/otlp/v1/logs", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function apiRequestBody(sessionId: string, inputTokens: number): unknown {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "session.id", value: { stringValue: sessionId } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  {
                    key: "event.name",
                    value: { stringValue: "claude_code.api_request" },
                  },
                  { key: "input_tokens", value: { intValue: inputTokens } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  agents.clear();
  agentLastModified.clear();
  resetSeenRequestsForTest();
});

describe("/api/otlp/v1/logs POST", () => {
  it("accepts a logs batch (no Origin) and folds tokens onto the session node", async () => {
    agents.set("s1", mockAgent({ id: "s1", sessionId: "s1" }));
    const res = await POST(post(apiRequestBody("s1", 42)));
    expect(res.status).toBe(200);
    expect(agents.get("s1")?.inputTokens).toBe(42);
  });

  it("returns 200 for an empty batch", async () => {
    const res = await POST(post({ resourceLogs: [] }));
    expect(res.status).toBe(200);
  });

  it("rejects a non-local Origin with 403", async () => {
    const res = await POST(post({ resourceLogs: [] }, "http://evil.example.com"));
    expect(res.status).toBe(403);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(post("{bad", "http://localhost"));
    expect(res.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds the cap", async () => {
    const req = new Request("http://localhost/api/otlp/v1/logs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(OTLP_MAX_BODY_BYTES + 1),
      },
      body: JSON.stringify({ resourceLogs: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});
