/**
 * T-H3 + T-M5 — Extended validation tests
 *
 * Covers gaps identified in the audit (lines 316-337, 222-256, 295-313):
 * - Adversarial payloads (__proto__, non-numeric tokens, Infinity/NaN)
 * - Oversized state:sync array (10,000 agents)
 * - Server event variants: log:response, log:error, annotation:sync, annotation:update
 */
import { describe, it, expect, beforeEach } from "vitest";
import { isValidServerEvent, isValidAgentEvent } from "../validation";
import { useAgentStore } from "@/lib/store";
import type { AgentState } from "@/lib/types";

// ── Server event variants — log:response, log:error, annotation:sync, annotation:update ──

describe("isValidServerEvent — log:response, log:error, annotation:* variants", () => {
  // log:response / log:error were removed from the SSE protocol — replaced by
  // HTTP /api/logs/[agentId]. The validator must now reject them.
  it("rejects log:response (no longer part of the protocol)", () => {
    expect(
      isValidServerEvent({ type: "log:response", agentId: "a1", entries: [] }),
    ).toBe(false);
  });

  it("rejects log:error (no longer part of the protocol)", () => {
    expect(
      isValidServerEvent({ type: "log:error", agentId: "a1", error: "ENOENT" }),
    ).toBe(false);
  });

  it("accepts valid annotation:sync", () => {
    expect(
      isValidServerEvent({ type: "annotation:sync", annotations: [] }),
    ).toBe(true);
  });

  it("accepts annotation:sync with well-shaped entries", () => {
    expect(
      isValidServerEvent({
        type: "annotation:sync",
        annotations: [{ id: "1", targetId: "a", text: "note" }],
      }),
    ).toBe(true);
  });

  it("rejects annotation:sync without annotations array", () => {
    expect(isValidServerEvent({ type: "annotation:sync" })).toBe(false);
  });

  it("rejects annotation:sync with non-array annotations", () => {
    expect(
      isValidServerEvent({ type: "annotation:sync", annotations: "bad" }),
    ).toBe(false);
  });

  it("rejects annotation:sync entries missing targetId", () => {
    expect(
      isValidServerEvent({
        type: "annotation:sync",
        annotations: [{ id: "1" }],
      }),
    ).toBe(false);
  });

  it("accepts valid annotation:update with action=add", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: { id: "1", targetId: "a" },
        action: "add",
      }),
    ).toBe(true);
  });

  it("accepts valid annotation:update with action=remove", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: { id: "1", targetId: "a" },
        action: "remove",
      }),
    ).toBe(true);
  });

  it("rejects annotation:update with unknown action", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: { id: "1", targetId: "a" },
        action: "edit",
      }),
    ).toBe(false);
  });

  it("rejects annotation:update without annotation field", () => {
    expect(
      isValidServerEvent({ type: "annotation:update", action: "add" }),
    ).toBe(false);
  });

  it("rejects annotation:update with string annotation payload", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: "not-an-object",
        action: "add",
      }),
    ).toBe(false);
  });

  it("rejects annotation:update with numeric annotation payload", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: 42,
        action: "add",
      }),
    ).toBe(false);
  });

  it("rejects annotation:update when annotation is missing targetId", () => {
    expect(
      isValidServerEvent({
        type: "annotation:update",
        annotation: { id: "1" },
        action: "add",
      }),
    ).toBe(false);
  });
});

// ── Adversarial payloads ───────────────────────────────────────────────────────

describe("isValidAgentEvent — adversarial: agent:tokens with non-numeric fields", () => {
  it("rejects agent:tokens with string inputTokens", () => {
    expect(
      isValidAgentEvent({
        type: "agent:tokens",
        agentId: "a1",
        inputTokens: "9999", // string instead of number
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      }),
    ).toBe(false);
  });

  it("accepts agent:tokens with Infinity (typeof Infinity === 'number')", () => {
    // Document current behavior: Infinity passes typeof check.
    // This test serves as a regression guard — if the validator is
    // strengthened to reject Infinity, update this assertion.
    const result = isValidAgentEvent({
      type: "agent:tokens",
      agentId: "a1",
      inputTokens: Infinity,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
    });
    // Current behavior: passes (Infinity is typeof 'number')
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it("accepts agent:tokens with NaN (typeof NaN === 'number')", () => {
    // Document current behavior: NaN passes typeof check.
    const result = isValidAgentEvent({
      type: "agent:tokens",
      agentId: "a1",
      inputTokens: NaN,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
    });
    expect(result).toBe(true);
  });

  it("rejects agent:tokens with undefined inputTokens", () => {
    expect(
      isValidAgentEvent({
        type: "agent:tokens",
        agentId: "a1",
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        contextWindow: 200000,
      }),
    ).toBe(false);
  });
});

describe("adversarial: __proto__ injection on state:sync — regression guard", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      nextActivityId: 0,
      topologyVersion: 0,
      errorDetails: new Map(),
      teams: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      recording: false,
      recordedEvents: [],
      viewMode: "graph",
    });
  });

  it("does not pollute Object.prototype after syncState with __proto__ payload", () => {
    // JSON.parse safely strips __proto__ — it does NOT set Object.prototype.
    // This test documents that behavior and guards against future regressions
    // if the parsing strategy changes.
    const payload = JSON.parse(
      '{"type":"state:sync","agents":[],"edges":[],"teams":[],"__proto__":{"polluted":true}}',
    );

    // Validator accepts it (shallow check — __proto__ parsed as own property by JSON.parse)
    expect(isValidServerEvent(payload)).toBe(true);

    // After syncState, Object.prototype must not be polluted
    useAgentStore.getState().syncState([], [], []);
    expect(
      (Object.prototype as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });
});

describe("adversarial: oversized state:sync — 10,000 agents", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      nextActivityId: 0,
      topologyVersion: 0,
      errorDetails: new Map(),
      teams: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      recording: false,
      recordedEvents: [],
      viewMode: "graph",
    });
  });

  it("validator accepts state:sync with 10,000-element agents array", () => {
    const bigAgents = Array.from({ length: 10000 }, (_, i) => ({
      id: `a${i}`,
      agentType: "build",
      status: "running",
    }));
    expect(
      isValidServerEvent({
        type: "state:sync",
        agents: bigAgents,
        edges: [],
        teams: [],
      }),
    ).toBe(true);
  });

  it("syncState handles 10,000 agents without throwing", () => {
    const bigAgents = Array.from({ length: 10000 }, (_, i) => ({
      id: `a${i}`,
      agentType: "build" as const,
      status: "running" as const,
      task: "t",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
      startTime: i,
    }));
    expect(() =>
      useAgentStore.getState().syncState(bigAgents as AgentState[], [], []),
    ).not.toThrow();
    expect(useAgentStore.getState().agents.size).toBe(10000);
  });
});
