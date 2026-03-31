import { describe, it, expect } from "vitest";
import { renderNodeVisuals, updateLinkVisuals } from "../d3";

describe("d3 module exports", () => {
  it("exports renderNodeVisuals as a function", () => {
    expect(typeof renderNodeVisuals).toBe("function");
  });

  it("exports updateLinkVisuals as a function", () => {
    expect(typeof updateLinkVisuals).toBe("function");
  });
});
