/**
 * T-M1 + T-M2 + T-M3 — agentSlice reducer paths
 *
 * Covers gaps from audit lines 64-79:
 * - agentTypeBudgets / setAgentTypeBudget action
 * - budgetExceeded flag computation
 * - waitingOn field + blocking-edge creation/clearing on agent:status
 * - Duplicate-event suppression (isDuplicateActivity)
 * - errorDetails / setErrorDetail action
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAgentStore } from "../../store";
import { isDuplicateActivity } from "../helpers";
import type { AgentEvent, AgentType } from "../../types";
import * as colors from "../../colors";

function resetState() {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    nextActivityId: 0,
    topologyVersion: 0,
    errorDetails: new Map(),
    teams: new Map(),
    agentTypeBudgets: {},
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    hiddenAgentTypes: new Set(),
    connected: false,
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
  });
}

beforeEach(resetState);

function registerAgent(
  agentId: string,
  agentType: AgentType = "build",
  parentId?: string,
) {
  useAgentStore.getState().handleEvent(
    {
      type: "agent:register",
      agentId,
      agentType,
      task: `task-${agentId}`,
      parentId,
    },
    Date.now(),
  );
}

function emitStatus(
  agentId: string,
  status: "running" | "waiting" | "idle" | "completed" | "error",
  opts: { waitingOn?: string; message?: string } = {},
) {
  useAgentStore
    .getState()
    .handleEvent(
      { type: "agent:status", agentId, status, ...opts },
      Date.now(),
    );
}

function emitTokens(
  agentId: string,
  inputTokens: number,
  outputTokens: number,
) {
  useAgentStore.getState().handleEvent(
    {
      type: "agent:tokens",
      agentId,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
    },
    Date.now(),
  );
}

// ── T-M1: agentTypeBudgets / setAgentTypeBudget ───────────────────────────────

describe("setAgentTypeBudget action", () => {
  it("sets a budget for an agent type", () => {
    useAgentStore.getState().setAgentTypeBudget("build", 50000);
    expect(useAgentStore.getState().agentTypeBudgets["build"]).toBe(50000);
  });

  it("updates an existing budget", () => {
    useAgentStore.getState().setAgentTypeBudget("build", 50000);
    useAgentStore.getState().setAgentTypeBudget("build", 100000);
    expect(useAgentStore.getState().agentTypeBudgets["build"]).toBe(100000);
  });

  it("removes a budget when limit is null", () => {
    useAgentStore.getState().setAgentTypeBudget("build", 50000);
    useAgentStore.getState().setAgentTypeBudget("build", null);
    expect(useAgentStore.getState().agentTypeBudgets["build"]).toBeUndefined();
  });

  it("supports independent budgets per agent type", () => {
    useAgentStore.getState().setAgentTypeBudget("build", 50000);
    useAgentStore.getState().setAgentTypeBudget("main", 200000);
    expect(useAgentStore.getState().agentTypeBudgets["build"]).toBe(50000);
    expect(useAgentStore.getState().agentTypeBudgets["main"]).toBe(200000);
  });
});

// ── T-M1: budgetExceeded flag computation ─────────────────────────────────────

describe("budgetExceeded flag on agent:tokens", () => {
  it("sets budgetExceeded=true when total tokens exceed the type budget", () => {
    registerAgent("a1", "build");
    useAgentStore.getState().setAgentTypeBudget("build", 100);
    emitTokens("a1", 80, 30); // 110 total > 100 limit
    expect(useAgentStore.getState().agents.get("a1")?.budgetExceeded).toBe(
      true,
    );
  });

  it("sets budgetExceeded=false when total tokens are within the type budget", () => {
    registerAgent("a1", "build");
    useAgentStore.getState().setAgentTypeBudget("build", 100);
    emitTokens("a1", 40, 30); // 70 total < 100 limit
    expect(useAgentStore.getState().agents.get("a1")?.budgetExceeded).toBe(
      false,
    );
  });

  it("leaves budgetExceeded=false when no budget is configured for the type", () => {
    registerAgent("a1", "build");
    // No budget set for "build"
    emitTokens("a1", 99999, 99999);
    expect(useAgentStore.getState().agents.get("a1")?.budgetExceeded).toBe(
      false,
    );
  });

  it("becomes false again if tokens drop below budget on next event", () => {
    registerAgent("a1", "build");
    useAgentStore.getState().setAgentTypeBudget("build", 100);
    emitTokens("a1", 80, 30); // 110 → exceeded
    expect(useAgentStore.getState().agents.get("a1")?.budgetExceeded).toBe(
      true,
    );

    // Token counts are cumulative-replaced (not additive) — simulate a reset
    emitTokens("a1", 20, 20); // 40 → under budget
    expect(useAgentStore.getState().agents.get("a1")?.budgetExceeded).toBe(
      false,
    );
  });
});

// ── T-M2: waitingOn field + blocking-edge creation/clearing ──────────────────

describe("waitingOn / blocking edges on agent:status", () => {
  it("creates a blocking edge when agent transitions to waiting with waitingOn", () => {
    registerAgent("a1");
    registerAgent("a2");

    emitStatus("a2", "waiting", { waitingOn: "a1" });

    const state = useAgentStore.getState();
    expect(state.agents.get("a2")?.waitingOn).toBe("a1");

    const blockingEdge = state.edges.find(
      (e) =>
        e.source === "a1" && e.target === "a2" && e.edgeType === "blocking",
    );
    expect(blockingEdge).toBeDefined();
  });

  it("does not create a duplicate blocking edge on repeated waiting events", () => {
    registerAgent("a1");
    registerAgent("a2");

    emitStatus("a2", "waiting", { waitingOn: "a1" });
    emitStatus("a2", "waiting", { waitingOn: "a1" });

    const blockingEdges = useAgentStore
      .getState()
      .edges.filter(
        (e) =>
          e.source === "a1" && e.target === "a2" && e.edgeType === "blocking",
      );
    expect(blockingEdges).toHaveLength(1);
  });

  it("removes the blocking edge when agent transitions away from waiting", () => {
    registerAgent("a1");
    registerAgent("a2");

    emitStatus("a2", "waiting", { waitingOn: "a1" });
    expect(
      useAgentStore.getState().edges.some((e) => e.edgeType === "blocking"),
    ).toBe(true);

    emitStatus("a2", "running");

    const state = useAgentStore.getState();
    expect(state.agents.get("a2")?.waitingOn).toBeUndefined();
    expect(state.edges.some((e) => e.edgeType === "blocking")).toBe(false);
  });

  it("clears blocking edge on agent:complete", () => {
    registerAgent("a1");
    registerAgent("a2");

    emitStatus("a2", "waiting", { waitingOn: "a1" });
    useAgentStore
      .getState()
      .handleEvent(
        { type: "agent:complete", agentId: "a2", duration: 1000 },
        Date.now(),
      );

    expect(
      useAgentStore.getState().edges.some((e) => e.edgeType === "blocking"),
    ).toBe(false);
  });
});

// ── T-M3: duplicate-event suppression (isDuplicateActivity) ──────────────────

describe("isDuplicateActivity helper", () => {
  it("returns false for empty activity log", () => {
    const event: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "running",
    };
    expect(isDuplicateActivity([], event)).toBe(false);
  });

  it("returns true for same-agent same-status in last 5 entries", () => {
    const event: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "running",
    };
    const activity = [{ id: "act-1", timestamp: 1000, event }];
    expect(isDuplicateActivity(activity, event)).toBe(true);
  });

  it("returns false for same-agent different-status", () => {
    const prev: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "running",
    };
    const next: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "idle",
    };
    const activity = [{ id: "act-1", timestamp: 1000, event: prev }];
    expect(isDuplicateActivity(activity, next)).toBe(false);
  });

  it("returns false for different-agent same-status", () => {
    const prev: AgentEvent = {
      type: "agent:status",
      agentId: "a1",
      status: "running",
    };
    const next: AgentEvent = {
      type: "agent:status",
      agentId: "a2",
      status: "running",
    };
    const activity = [{ id: "act-1", timestamp: 1000, event: prev }];
    expect(isDuplicateActivity(activity, next)).toBe(false);
  });

  it("returns true for duplicate agent:register (same agentId)", () => {
    const event: AgentEvent = {
      type: "agent:register",
      agentId: "a1",
      agentType: "build",
      task: "t",
    };
    const activity = [{ id: "act-1", timestamp: 1000, event }];
    expect(isDuplicateActivity(activity, event)).toBe(true);
  });

  it("returns false for first agent:register (not yet in log)", () => {
    const event: AgentEvent = {
      type: "agent:register",
      agentId: "a1",
      agentType: "build",
      task: "t",
    };
    expect(isDuplicateActivity([], event)).toBe(false);
  });

  it("returns false for non-duplicate event types (e.g. agent:tokens)", () => {
    const event: AgentEvent = {
      type: "agent:tokens",
      agentId: "a1",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
    };
    const activity = [{ id: "act-1", timestamp: 1000, event }];
    expect(isDuplicateActivity(activity, event)).toBe(false);
  });
});

describe("duplicate suppression via handleEvent", () => {
  it("same agent:status twice → only one activity entry", () => {
    registerAgent("a1");
    emitStatus("a1", "running");
    emitStatus("a1", "running"); // duplicate

    const { activity } = useAgentStore.getState();
    const statusEntries = activity.filter(
      (e) => e.event.type === "agent:status" && e.event.agentId === "a1",
    );
    expect(statusEntries).toHaveLength(1);
  });

  it("different status events → both recorded", () => {
    registerAgent("a1");
    emitStatus("a1", "running");
    emitStatus("a1", "idle");

    const { activity } = useAgentStore.getState();
    const statusEntries = activity.filter(
      (e) => e.event.type === "agent:status" && e.event.agentId === "a1",
    );
    expect(statusEntries).toHaveLength(2);
  });

  it("duplicate agent:register → only one activity entry", () => {
    registerAgent("a1");
    registerAgent("a1"); // duplicate register (re-register / metadata refresh)

    const { activity } = useAgentStore.getState();
    const registerEntries = activity.filter(
      (e) => e.event.type === "agent:register" && e.event.agentId === "a1",
    );
    expect(registerEntries).toHaveLength(1);
  });
});

// ── errorDetails / setErrorDetail action ─────────────────────────────────────

describe("errorDetails slice — setErrorDetail action", () => {
  it("stores an error detail for an agent", () => {
    useAgentStore.getState().setErrorDetail("a1", {
      agentId: "a1",
      message: "something went wrong",
      cascadeIds: [],
      timestamp: 1000,
    });
    const detail = useAgentStore.getState().errorDetails.get("a1");
    expect(detail).toBeDefined();
    expect(detail?.message).toBe("something went wrong");
    expect(detail?.cascadeIds).toEqual([]);
  });

  it("overwrites existing error detail for same agent", () => {
    useAgentStore.getState().setErrorDetail("a1", {
      agentId: "a1",
      message: "first error",
      cascadeIds: [],
      timestamp: 1000,
    });
    useAgentStore.getState().setErrorDetail("a1", {
      agentId: "a1",
      message: "second error",
      cascadeIds: ["a2"],
      timestamp: 2000,
    });
    const detail = useAgentStore.getState().errorDetails.get("a1");
    expect(detail?.message).toBe("second error");
    expect(detail?.cascadeIds).toEqual(["a2"]);
  });

  it("populates errorDetails on agent:status error event", () => {
    registerAgent("a1");
    emitStatus("a1", "error", { message: "crashed" });

    const detail = useAgentStore.getState().errorDetails.get("a1");
    expect(detail).toBeDefined();
    expect(detail?.agentId).toBe("a1");
    expect(detail?.message).toBe("crashed");
    expect(detail?.cascadeIds).toEqual([]);
  });
});

// ── removeAgent calls releaseAgentColor ───────────────────────────────────────

describe("removeAgent releases agent color", () => {
  it("calls releaseAgentColor with the removed agent id", () => {
    const spy = vi.spyOn(colors, "releaseAgentColor");
    registerAgent("a1");
    useAgentStore.getState().removeAgent("a1");
    expect(spy).toHaveBeenCalledWith("a1");
    spy.mockRestore();
  });
});
