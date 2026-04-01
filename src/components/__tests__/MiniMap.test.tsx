import { describe, it, expect } from "vitest";

describe("MiniMap", () => {
  it("can be imported without error", async () => {
    const mod = await import("../MiniMap");
    expect(mod.MiniMap).toBeDefined();
  });
});
