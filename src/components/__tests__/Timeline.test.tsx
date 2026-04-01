import { describe, it, expect } from "vitest";

describe("Timeline", () => {
  it("can be imported without error", async () => {
    const mod = await import("../Timeline");
    expect(mod.Timeline).toBeDefined();
  });
});
