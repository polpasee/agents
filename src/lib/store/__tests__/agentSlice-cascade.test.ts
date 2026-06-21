import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../store";
import type { AgentEvent, AgentState } from "../../types";

beforeEach(() => {
  useAgentStore.setState({
    agents: new Map(),
    edges: [],
    activity: [],
    errorDetails: new Map(),
    selectedAgentId: null,
    selectedSessionIds: new Set(),
    connected: false,
    hiddenAgentTypes: new Set(),
    recording: false,
    recordedEvents: [],
    viewMode: "graph",
  });
});

function registerAgent(
  agentId: string,
  options: { parentId?: string; agentType?: AgentState["agentType"] } = {},
) {
  const event: AgentEvent = {
    type: "agent:register",
    agentId,
    agentType: options.agentType ?? "build",
    task: `task-${agentId}`,
    parentId: options.parentId,
  };
  useAgentStore.getState().handleEvent(event, Date.now());
}

function setError(agentId: string) {
  const event: AgentEvent = {
    type: "agent:status",
    agentId,
    status: "error",
    message: `error in ${agentId}`,
  };
  useAgentStore.getState().handleEvent(event, Date.now());
}

describe("error cascade: parent errors first, then child errors", () => {
  it("adds the new child to the previously-errored parent's cascadeIds", () => {
    registerAgent("parent");
    registerAgent("child", { parentId: "parent" });

    setError("parent");
    setError("child");

    const parentDetail = useAgentStore.getState().errorDetails.get("parent");
    expect(parentDetail).toBeDefined();
    expect(parentDetail?.cascadeIds ?? []).toContain("child");
  });
});

describe("error cascade: child errors first, then parent errors", () => {
  it("does NOT add the newly-errored parent to the already-errored child's cascadeIds", () => {
    registerAgent("parent");
    registerAgent("child", { parentId: "parent" });

    setError("child");
    // Snapshot child's cascade BEFORE parent errors.
    const childCascadeBefore =
      useAgentStore.getState().errorDetails.get("child")?.cascadeIds ?? [];

    setError("parent");

    const childDetail = useAgentStore.getState().errorDetails.get("child");
    // The new parent error must not retroactively be appended to a child that
    // already failed: a parent that errors AFTER its child cannot have caused
    // that child's failure.
    expect(childDetail?.cascadeIds ?? []).toEqual(childCascadeBefore);
    expect(childDetail?.cascadeIds ?? []).not.toContain("parent");
  });
});

describe("error cascade: two unrelated agents both error", () => {
  it("does not cross-link cascadeIds between unrelated errored agents", () => {
    registerAgent("a");
    registerAgent("b");

    setError("a");
    setError("b");

    const detailA = useAgentStore.getState().errorDetails.get("a");
    const detailB = useAgentStore.getState().errorDetails.get("b");

    expect(detailA?.cascadeIds ?? []).not.toContain("b");
    expect(detailB?.cascadeIds ?? []).not.toContain("a");
  });
});

describe("error cascade: three-level chain (grandparent → parent → child)", () => {
  it("threads the cascade so each ancestor lists newly-failing descendants", () => {
    registerAgent("grandparent");
    registerAgent("parent", { parentId: "grandparent" });
    registerAgent("child", { parentId: "parent" });

    setError("grandparent");
    setError("parent");
    setError("child");

    const gpDetail = useAgentStore.getState().errorDetails.get("grandparent");
    const parentDetail = useAgentStore.getState().errorDetails.get("parent");
    const childDetail = useAgentStore.getState().errorDetails.get("child");

    // grandparent errored first; its cascade must include the descendants
    // that errored after it (parent is the direct child registered to it).
    expect(gpDetail?.cascadeIds ?? []).toContain("parent");

    // parent errored after grandparent; its cascade should include child
    // (child errored after parent).
    expect(parentDetail?.cascadeIds ?? []).toContain("child");

    // child errored last; its cascade must not contain its ancestors —
    // ancestors that erred BEFORE child did not cascade FROM child.
    expect(childDetail?.cascadeIds ?? []).not.toContain("grandparent");
    expect(childDetail?.cascadeIds ?? []).not.toContain("parent");
  });
});
