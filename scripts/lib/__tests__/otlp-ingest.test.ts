import { describe, it, expect, beforeEach } from "vitest";
import {
  flattenAttrs,
  resolveTokenNodeId,
  ingestOtlpLogs,
  resetSeenRequestsForTest,
} from "../otlp-ingest";
import { agents, agentLastModified } from "../agent-state";
import { pendingSubKey } from "../push-ingest";
import { mockAgent } from "../../../src/lib/__tests__/test-utils";

beforeEach(() => {
  agents.clear();
  agentLastModified.clear();
  resetSeenRequestsForTest();
});

function apiRequestBody(
  attrs: Record<string, unknown>,
  resourceAttrs: Record<string, unknown> = {},
): unknown {
  const toKv = (o: Record<string, unknown>) =>
    Object.entries(o).map(([key, value]) => ({
      key,
      value:
        typeof value === "number"
          ? { intValue: value }
          : typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: String(value) },
    }));
  return {
    resourceLogs: [
      {
        resource: { attributes: toKv(resourceAttrs) },
        scopeLogs: [{ logRecords: [{ attributes: toKv(attrs) }] }],
      },
    ],
  };
}

describe("flattenAttrs", () => {
  it("unwraps each AnyValue type and skips empties", () => {
    const out = flattenAttrs([
      { key: "s", value: { stringValue: "x" } },
      { key: "i", value: { intValue: "42" } },
      { key: "d", value: { doubleValue: 1.5 } },
      { key: "b", value: { boolValue: true } },
      { key: "skip", value: {} },
      { key: "nokey" } as unknown as { key: string },
    ]);
    expect(out).toEqual({ s: "x", i: 42, d: 1.5, b: true });
  });
  it("returns an empty map for non-array input", () => {
    expect(flattenAttrs(undefined)).toEqual({});
  });
});

describe("resolveTokenNodeId", () => {
  it("maps main / absent query_source to the session node", () => {
    expect(resolveTokenNodeId({ "session.id": "sess-1" })).toBe("sess-1");
    expect(
      resolveTokenNodeId({ "session.id": "sess-1", query_source: "main" }),
    ).toBe("sess-1");
  });
  it("returns undefined without a session id", () => {
    expect(resolveTokenNodeId({ query_source: "main" })).toBeUndefined();
  });
  it("routes a subagent to the most recently active matching node", () => {
    agents.set(
      "old",
      mockAgent({ id: "old", sessionId: "sess-1", agentType: "explore" }),
    );
    agents.set(
      "new",
      mockAgent({ id: "new", sessionId: "sess-1", agentType: "explore" }),
    );
    agentLastModified.set("old", 100);
    agentLastModified.set("new", 200);
    expect(
      resolveTokenNodeId({
        "session.id": "sess-1",
        query_source: "subagent",
        "agent.name": "explore",
      }),
    ).toBe("new");
  });
  it("buffers under a name-scoped key (not the main) when no subagent matches", () => {
    // Tokens for a not-yet-registered subagent must be held for the real node,
    // not misattributed to the session main.
    expect(
      resolveTokenNodeId({
        "session.id": "sess-1",
        query_source: "subagent",
        "agent.name": "nope",
      }),
    ).toBe(pendingSubKey("sess-1", "nope"));
  });
  it("falls back to the session main only when agent.name is absent", () => {
    expect(
      resolveTokenNodeId({ "session.id": "sess-1", query_source: "subagent" }),
    ).toBe("sess-1");
  });
});

describe("ingestOtlpLogs", () => {
  it("accumulates api_request token counts onto the session node", () => {
    agents.set("sess-1", mockAgent({ id: "sess-1", sessionId: "sess-1" }));
    ingestOtlpLogs(
      apiRequestBody(
        {
          "event.name": "claude_code.api_request",
          request_id: "r1",
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 2,
          cache_creation_tokens: 1,
        },
        { "session.id": "sess-1" },
      ),
    );
    const a = agents.get("sess-1");
    expect(a?.inputTokens).toBe(10);
    expect(a?.outputTokens).toBe(5);
    expect(a?.cacheReadTokens).toBe(2);
    expect(a?.cacheCreateTokens).toBe(1);
  });

  it("dedupes a repeated request_id (OTLP retry)", () => {
    agents.set("sess-1", mockAgent({ id: "sess-1", sessionId: "sess-1" }));
    const body = apiRequestBody(
      {
        "event.name": "claude_code.api_request",
        request_id: "r1",
        input_tokens: 10,
      },
      { "session.id": "sess-1" },
    );
    ingestOtlpLogs(body);
    ingestOtlpLogs(body);
    expect(agents.get("sess-1")?.inputTokens).toBe(10);
  });

  it("ignores malformed / empty batches", () => {
    expect(() => ingestOtlpLogs({})).not.toThrow();
    expect(() => ingestOtlpLogs({ resourceLogs: [] })).not.toThrow();
    expect(() => ingestOtlpLogs(null)).not.toThrow();
  });
});
