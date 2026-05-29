import { describe, it, expect } from "vitest";
import { endpointId } from "../d3/endpointId";
import type { SimNode } from "../d3/updateLinks";

function makeNode(id: string): SimNode {
  return {
    id,
    agent: {
      id,
      agentType: "main",
      status: "running",
      task: "",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 200000,
      startTime: 0,
    },
  };
}

describe("endpointId", () => {
  it("returns the string as-is when given a plain string", () => {
    expect(endpointId("agent-abc")).toBe("agent-abc");
  });

  it("returns node.id when given a SimNode object", () => {
    const node = makeNode("agent-xyz");
    expect(endpointId(node)).toBe("agent-xyz");
  });

  it("distinguishes between two different string ids", () => {
    expect(endpointId("a")).not.toBe(endpointId("b"));
  });

  it("distinguishes between two different node ids", () => {
    expect(endpointId(makeNode("n1"))).not.toBe(endpointId(makeNode("n2")));
  });

  it("string and node with the same id resolve to the same value", () => {
    expect(endpointId("same")).toBe(endpointId(makeNode("same")));
  });
});
