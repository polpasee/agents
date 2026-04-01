import { describe, it, expect } from "vitest";

describe("HeatmapControls", () => {
  it("can be imported without error", async () => {
    const mod = await import("../HeatmapControls");
    expect(mod.HeatmapControls).toBeDefined();
  });
});
