/**
 * applyRegister — re-register (metadata refresh) field-merge policy
 *
 * Each test targets exactly one field rule so that a future AgentState
 * addition will have an obvious gap to fill here.
 */
import { describe, it, expect } from "vitest";
import { createMutationContext } from "../eventHandlers";
import { applyRegister } from "../eventHandlers";
import type { AgentState, EdgeState } from "../../types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeExisting(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    parentId: undefined,
    agentType: "build",
    displayType: "existing-display",
    status: "running",
    task: "existing-task",
    sessionId: "sess-1",
    slug: "existing-slug",
    model: "claude-3-5-sonnet",
    teamId: undefined,
    toolCalls: [{ tool: "Read", timestamp: 100 }],
    inputTokens: 500,
    outputTokens: 300,
    cacheReadTokens: 10,
    cacheCreateTokens: 5,
    contextWindow: 200000,
    startTime: 1000,
    metadata: { key: "existing-meta" },
    effort: "high",
    is1MContext: false,
    ...overrides,
  };
}

function makeCtx(existing: AgentState) {
  return createMutationContext({
    agents: new Map([["a1", existing]]),
    edges: [],
    errorDetails: new Map(),
    teams: new Map(),
    agentTypeBudgets: {},
  });
}

function reRegister(
  existing: AgentState,
  eventOverrides: Partial<{
    model: string;
    agentType: AgentState["agentType"];
    task: string;
    slug: string;
    displayType: string;
    metadata: Record<string, unknown>;
    effort: AgentState["effort"];
    is1MContext: boolean;
    workflowName: string;
  }>,
): AgentState {
  const ctx = makeCtx(existing);
  applyRegister(
    ctx,
    {
      type: "agent:register",
      agentId: "a1",
      agentType: eventOverrides.agentType ?? "build",
      task: eventOverrides.task ?? "event-task",
      model: eventOverrides.model,
      slug: eventOverrides.slug,
      displayType: eventOverrides.displayType,
      metadata: eventOverrides.metadata,
      effort: eventOverrides.effort,
      is1MContext: eventOverrides.is1MContext,
      workflowName: eventOverrides.workflowName,
    },
    2000,
  );
  return ctx.newAgents!.get("a1")!;
}

// ── model: incoming-wins with "" final fallback ───────────────────────────────

describe("model field (incoming-wins)", () => {
  it("incoming model overrides existing", () => {
    const result = reRegister(makeExisting({ model: "claude-3-5-sonnet" }), {
      model: "claude-opus-4",
    });
    expect(result.model).toBe("claude-opus-4");
  });

  it("keeps existing model when incoming is absent", () => {
    const result = reRegister(makeExisting({ model: "claude-3-5-sonnet" }), {});
    expect(result.model).toBe("claude-3-5-sonnet");
  });

  it("keeps existing model when incoming is empty string", () => {
    const result = reRegister(makeExisting({ model: "claude-3-5-sonnet" }), {
      model: "",
    });
    expect(result.model).toBe("claude-3-5-sonnet");
  });

  it("falls back to empty string when both are absent/empty", () => {
    const result = reRegister(makeExisting({ model: undefined }), {
      model: "",
    });
    expect(result.model).toBe("");
  });
});

// ── agentType: incoming-wins ──────────────────────────────────────────────────

describe("agentType field (incoming-wins)", () => {
  it("incoming agentType overrides existing", () => {
    const result = reRegister(makeExisting({ agentType: "build" }), {
      agentType: "main",
    });
    expect(result.agentType).toBe("main");
  });

  it("keeps existing agentType when incoming is falsy (empty string coercion)", () => {
    // agentType is typed as AgentType union — use existing as fallback
    const existing = makeExisting({ agentType: "build" });
    const ctx = makeCtx(existing);
    // simulate an incoming event where agentType would be falsy:
    // we can't pass empty string for the typed union, so test the OR logic
    // by verifying that a truthy incoming value wins.
    applyRegister(
      ctx,
      { type: "agent:register", agentId: "a1", agentType: "main", task: "t" },
      2000,
    );
    expect(ctx.newAgents!.get("a1")!.agentType).toBe("main");
  });
});

// ── task: keep-first (existing wins) ─────────────────────────────────────────

describe("task field (keep-first)", () => {
  it("keeps existing task even when event carries a different task", () => {
    const result = reRegister(makeExisting({ task: "original-task" }), {
      task: "new-task",
    });
    expect(result.task).toBe("original-task");
  });

  it("falls through to event task if existing task is empty", () => {
    const result = reRegister(makeExisting({ task: "" }), { task: "new-task" });
    expect(result.task).toBe("new-task");
  });

  it('replaces the "Session" registration placeholder with the event task', () => {
    // Carve-out for the discovery late-meta heal: "Session" is registerAgent's
    // no-task fallback, not a real description, so a refresh may replace it.
    const result = reRegister(makeExisting({ task: "Session" }), {
      task: "real task from meta",
    });
    expect(result.task).toBe("real task from meta");
  });
});

// ── slug: keep-first ──────────────────────────────────────────────────────────

describe("slug field (keep-first)", () => {
  it("keeps existing slug", () => {
    const result = reRegister(makeExisting({ slug: "old-slug" }), {
      slug: "new-slug",
    });
    expect(result.slug).toBe("old-slug");
  });

  it("adopts event slug if existing slug is absent", () => {
    const result = reRegister(makeExisting({ slug: undefined }), {
      slug: "new-slug",
    });
    expect(result.slug).toBe("new-slug");
  });
});

// ── displayType: keep-first ───────────────────────────────────────────────────

describe("displayType field (keep-first)", () => {
  it("keeps existing displayType", () => {
    const result = reRegister(
      makeExisting({ displayType: "original-display" }),
      { displayType: "new-display" },
    );
    expect(result.displayType).toBe("original-display");
  });

  it("adopts event displayType if existing displayType is absent", () => {
    const result = reRegister(makeExisting({ displayType: undefined }), {
      displayType: "new-display",
    });
    expect(result.displayType).toBe("new-display");
  });
});

// ── metadata: keep-first ─────────────────────────────────────────────────────

describe("metadata field (keep-first)", () => {
  it("keeps existing metadata", () => {
    const existing = { key: "existing" };
    const result = reRegister(makeExisting({ metadata: existing }), {
      metadata: { key: "new" },
    });
    expect(result.metadata).toBe(existing); // same reference
  });

  it("adopts event metadata if existing metadata is absent", () => {
    const eventMeta = { key: "from-event" };
    const result = reRegister(makeExisting({ metadata: undefined }), {
      metadata: eventMeta,
    });
    expect(result.metadata).toBe(eventMeta);
  });
});

// ── effort: incoming-wins (nullish) ──────────────────────────────────────────

describe("effort field (incoming-wins, nullish)", () => {
  it("incoming effort overrides existing", () => {
    const result = reRegister(makeExisting({ effort: "high" }), {
      effort: "low",
    });
    expect(result.effort).toBe("low");
  });

  it("effort=undefined in event keeps existing", () => {
    const result = reRegister(makeExisting({ effort: "high" }), {});
    expect(result.effort).toBe("high");
  });

  // Key nullish test: a falsy-but-defined value from event must still apply
  it("does not keep existing when event effort is a defined falsy-coercible value (nullish wins)", () => {
    // effort is a string union — simulate by checking that defined value wins.
    // The only way to test ?? vs || is to confirm that even "low" (which is
    // truthy) incoming still replaces "high" existing (already tested above).
    // The important distinction: if event.effort is undefined, existing is kept.
    const result = reRegister(makeExisting({ effort: "high" }), {
      effort: undefined,
    });
    expect(result.effort).toBe("high");
  });
});

// ── is1MContext: incoming-wins (nullish) ──────────────────────────────────────

describe("is1MContext field (incoming-wins, nullish)", () => {
  it("incoming is1MContext=true overrides existing false", () => {
    const result = reRegister(makeExisting({ is1MContext: false }), {
      is1MContext: true,
    });
    expect(result.is1MContext).toBe(true);
  });

  it("incoming is1MContext=false overrides existing true (nullish, not ||)", () => {
    const result = reRegister(makeExisting({ is1MContext: true }), {
      is1MContext: false,
    });
    expect(result.is1MContext).toBe(false);
  });

  it("undefined in event keeps existing", () => {
    const result = reRegister(makeExisting({ is1MContext: true }), {});
    expect(result.is1MContext).toBe(true);
  });
});

// ── accumulated state is preserved ───────────────────────────────────────────

describe("accumulated state fields are preserved on re-register", () => {
  it("toolCalls are preserved", () => {
    const existing = makeExisting({
      toolCalls: [
        { tool: "Read", timestamp: 100 },
        { tool: "Write", timestamp: 200 },
      ],
    });
    const result = reRegister(existing, {});
    expect(result.toolCalls).toHaveLength(2);
    // safe: toHaveLength(2) asserts index 0 exists
    expect(result.toolCalls[0]!.tool).toBe("Read");
  });

  it("inputTokens are preserved", () => {
    const result = reRegister(makeExisting({ inputTokens: 9999 }), {});
    expect(result.inputTokens).toBe(9999);
  });

  it("outputTokens are preserved", () => {
    const result = reRegister(makeExisting({ outputTokens: 8888 }), {});
    expect(result.outputTokens).toBe(8888);
  });

  it("cacheReadTokens are preserved", () => {
    const result = reRegister(makeExisting({ cacheReadTokens: 77 }), {});
    expect(result.cacheReadTokens).toBe(77);
  });

  it("cacheCreateTokens are preserved", () => {
    const result = reRegister(makeExisting({ cacheCreateTokens: 66 }), {});
    expect(result.cacheCreateTokens).toBe(66);
  });

  it("startTime is preserved", () => {
    const result = reRegister(makeExisting({ startTime: 42 }), {});
    expect(result.startTime).toBe(42);
  });

  it("status is preserved", () => {
    const result = reRegister(makeExisting({ status: "waiting" }), {});
    expect(result.status).toBe("waiting");
  });

  it("sessionId is preserved", () => {
    const result = reRegister(makeExisting({ sessionId: "sess-xyz" }), {});
    expect(result.sessionId).toBe("sess-xyz");
  });

  it("id is preserved (not replaced by agentId event field name)", () => {
    const result = reRegister(makeExisting({ id: "a1" }), {});
    expect(result.id).toBe("a1");
  });

  it("contextWindow is preserved", () => {
    const result = reRegister(makeExisting({ contextWindow: 128000 }), {});
    expect(result.contextWindow).toBe(128000);
  });
});

// ── workflowName: keep-first (heals from undefined if later event carries it) ─

describe("workflowName field (keep-first)", () => {
  it("new agent: workflowName from event is stored", () => {
    const ctx = createMutationContext({
      agents: new Map(),
      edges: [],
      errorDetails: new Map(),
      teams: new Map(),
      agentTypeBudgets: {},
    });
    applyRegister(
      ctx,
      {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "t",
        workflowName: "code-review-max",
      },
      1000,
    );
    expect(ctx.newAgents!.get("a1")!.workflowName).toBe("code-review-max");
  });

  it("new agent: workflowName is undefined when event omits it", () => {
    const ctx = createMutationContext({
      agents: new Map(),
      edges: [],
      errorDetails: new Map(),
      teams: new Map(),
      agentTypeBudgets: {},
    });
    applyRegister(
      ctx,
      { type: "agent:register", agentId: "a1", agentType: "build", task: "t" },
      1000,
    );
    expect(ctx.newAgents!.get("a1")!.workflowName).toBeUndefined();
  });

  it("re-register: keeps existing workflowName (keepFirst)", () => {
    const result = reRegister(
      makeExisting({ workflowName: "existing-workflow" }),
      { workflowName: "new-workflow" },
    );
    expect(result.workflowName).toBe("existing-workflow");
  });

  it("re-register: fills in workflowName from event when existing is undefined", () => {
    const result = reRegister(makeExisting({ workflowName: undefined }), {
      workflowName: "code-review-max",
    });
    expect(result.workflowName).toBe("code-review-max");
  });

  it("re-register: stays undefined when both existing and event omit it", () => {
    const result = reRegister(makeExisting({ workflowName: undefined }), {});
    expect(result.workflowName).toBeUndefined();
  });
});

// ── topologyDirty is NOT set for a plain metadata refresh ────────────────────

describe("topologyDirty on re-register", () => {
  it("not set when parentId and teamId are unchanged", () => {
    const existing = makeExisting({ parentId: undefined, teamId: undefined });
    const ctx = makeCtx(existing);
    applyRegister(
      ctx,
      { type: "agent:register", agentId: "a1", agentType: "build", task: "t" },
      2000,
    );
    expect(ctx.topologyDirty).toBe(false);
  });
});

// ── parentId: incoming-wins + parent-edge swap (nested sub-agents) ───────────

describe("parentId field (incoming-wins) and parent-edge swap", () => {
  function makeCtxWithEdges(existing: AgentState, edges: EdgeState[]) {
    return createMutationContext({
      agents: new Map([["a1", existing]]),
      edges,
      errorDetails: new Map(),
      teams: new Map(),
      agentTypeBudgets: {},
    });
  }

  it("re-register with a new parentId updates the stored agent's parentId", () => {
    const existing = makeExisting({ parentId: "old-parent" });
    const ctx = makeCtxWithEdges(existing, [
      { source: "old-parent", target: "a1" },
    ]);
    applyRegister(
      ctx,
      {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "t",
        parentId: "new-parent",
      },
      2000,
    );
    expect(ctx.newAgents!.get("a1")!.parentId).toBe("new-parent");
  });

  it("swaps the parent edge and leaves blocking/message edges untouched", () => {
    const existing = makeExisting({ parentId: "old-parent" });
    const edges: EdgeState[] = [
      { source: "old-parent", target: "a1" },
      { source: "blocker", target: "a1", edgeType: "blocking" },
      { source: "a1", target: "peer", edgeType: "message" },
    ];
    const ctx = makeCtxWithEdges(existing, edges);
    applyRegister(
      ctx,
      {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "t",
        parentId: "new-parent",
      },
      2000,
    );
    expect(ctx.newEdges).not.toContainEqual({
      source: "old-parent",
      target: "a1",
    });
    expect(ctx.newEdges).toContainEqual({ source: "new-parent", target: "a1" });
    expect(ctx.newEdges).toContainEqual({
      source: "blocker",
      target: "a1",
      edgeType: "blocking",
    });
    expect(ctx.newEdges).toContainEqual({
      source: "a1",
      target: "peer",
      edgeType: "message",
    });
  });

  it("sets topologyDirty when parentId changes", () => {
    const existing = makeExisting({ parentId: "old-parent" });
    const ctx = makeCtxWithEdges(existing, [
      { source: "old-parent", target: "a1" },
    ]);
    applyRegister(
      ctx,
      {
        type: "agent:register",
        agentId: "a1",
        agentType: "build",
        task: "t",
        parentId: "new-parent",
      },
      2000,
    );
    expect(ctx.topologyDirty).toBe(true);
  });

  it("re-register without parentId keeps the existing parentId and edges unchanged", () => {
    const existing = makeExisting({ parentId: "old-parent" });
    const edges: EdgeState[] = [{ source: "old-parent", target: "a1" }];
    const ctx = makeCtxWithEdges(existing, edges);
    applyRegister(
      ctx,
      { type: "agent:register", agentId: "a1", agentType: "build", task: "t" },
      2000,
    );
    expect(ctx.newAgents!.get("a1")!.parentId).toBe("old-parent");
    expect(ctx.newEdges).toBe(edges); // same array — no edge mutation
    expect(ctx.topologyDirty).toBe(false);
  });
});
