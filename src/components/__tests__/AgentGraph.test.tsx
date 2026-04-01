import { describe, it, expect } from "vitest";

describe("AgentGraph", () => {
  it("can be imported without error", async () => {
    const mod = await import("../AgentGraph");
    expect(mod.AgentGraph).toBeDefined();
  });
});
