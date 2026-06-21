import { describe, it, expect } from "vitest";
import { resolveSessionId } from "../sessions";
import type { AgentState } from "../types";
import { mockAgent } from "./test-utils";

function makeMap(...agents: AgentState[]): Map<string, AgentState> {
  return new Map(agents.map((a) => [a.id, a]));
}

describe("resolveSessionId", () => {
  it("root agent with sessionId — returns sessionId", () => {
    const a = mockAgent({ id: "root", sessionId: "sess-1" });
    expect(resolveSessionId(a, makeMap(a))).toBe("sess-1");
  });

  it("root agent without sessionId — returns own id", () => {
    const a = mockAgent({ id: "root", sessionId: undefined });
    expect(resolveSessionId(a, makeMap(a))).toBe("root");
  });

  it("child agent — returns parent's sessionId", () => {
    const parent = mockAgent({ id: "parent", sessionId: "sess-parent" });
    const child = mockAgent({
      id: "child",
      parentId: "parent",
      sessionId: "sess-child",
    });
    expect(resolveSessionId(child, makeMap(parent, child))).toBe("sess-parent");
  });

  it("grandchild agent — returns root sessionId (not intermediate)", () => {
    const root = mockAgent({ id: "root", sessionId: "sess-root" });
    const mid = mockAgent({
      id: "mid",
      parentId: "root",
      sessionId: "sess-mid",
    });
    const leaf = mockAgent({
      id: "leaf",
      parentId: "mid",
      sessionId: "sess-leaf",
    });
    expect(resolveSessionId(leaf, makeMap(root, mid, leaf))).toBe("sess-root");
  });

  it("missing parent — stops at last known ancestor", () => {
    // child's parent is not in the map; child itself has no sessionId
    const child = mockAgent({
      id: "child",
      parentId: "ghost",
      sessionId: undefined,
    });
    expect(resolveSessionId(child, makeMap(child))).toBe("child");
  });

  it("missing parent — stops at last known ancestor that has a sessionId", () => {
    const mid = mockAgent({
      id: "mid",
      parentId: "ghost",
      sessionId: "sess-mid",
    });
    const leaf = mockAgent({ id: "leaf", parentId: "mid" });
    expect(resolveSessionId(leaf, makeMap(mid, leaf))).toBe("sess-mid");
  });

  it("cycle — terminates without infinite loop", () => {
    // a → b → a (cycle)
    const a = mockAgent({ id: "a", parentId: "b", sessionId: "sess-a" });
    const b = mockAgent({ id: "b", parentId: "a", sessionId: "sess-b" });
    // Should return one of their sessionIds without hanging
    const result = resolveSessionId(a, makeMap(a, b));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("root agent with sessionId undefined and no parent — falls back to id", () => {
    const a = mockAgent({
      id: "solo",
      sessionId: undefined,
      parentId: undefined,
    });
    expect(resolveSessionId(a, makeMap(a))).toBe("solo");
  });
});
