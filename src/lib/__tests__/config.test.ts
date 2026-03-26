import { describe, it, expect } from "vitest";
import {
  WS_URL,
  WS_RECONNECT_DELAY_MS,
  ACTIVITY_MAX_ENTRIES,
  TOOL_CALLS_MAX_PER_AGENT,
  DEFAULT_CONTEXT_WINDOW,
  GRAPH,
} from "../config";

describe("Client-side config", () => {
  it("WS_URL is a valid ws:// URL string", () => {
    expect(typeof WS_URL).toBe("string");
    expect(WS_URL).toMatch(/^ws:\/\/.+/);
  });

  it("WS_RECONNECT_DELAY_MS is a positive number", () => {
    expect(typeof WS_RECONNECT_DELAY_MS).toBe("number");
    expect(WS_RECONNECT_DELAY_MS).toBeGreaterThan(0);
  });

  it("ACTIVITY_MAX_ENTRIES is a positive integer", () => {
    expect(typeof ACTIVITY_MAX_ENTRIES).toBe("number");
    expect(Number.isInteger(ACTIVITY_MAX_ENTRIES)).toBe(true);
    expect(ACTIVITY_MAX_ENTRIES).toBeGreaterThan(0);
  });

  it("TOOL_CALLS_MAX_PER_AGENT is a positive integer", () => {
    expect(typeof TOOL_CALLS_MAX_PER_AGENT).toBe("number");
    expect(Number.isInteger(TOOL_CALLS_MAX_PER_AGENT)).toBe(true);
    expect(TOOL_CALLS_MAX_PER_AGENT).toBeGreaterThan(0);
  });

  it("DEFAULT_CONTEXT_WINDOW is a positive number", () => {
    expect(typeof DEFAULT_CONTEXT_WINDOW).toBe("number");
    expect(DEFAULT_CONTEXT_WINDOW).toBeGreaterThan(0);
  });

  describe("GRAPH object", () => {
    it("all values are numbers (except zoomExtent which is a tuple)", () => {
      for (const [key, value] of Object.entries(GRAPH)) {
        if (key === "zoomExtent") {
          expect(Array.isArray(value)).toBe(true);
          const tuple = value as [number, number];
          expect(tuple).toHaveLength(2);
          expect(typeof tuple[0]).toBe("number");
          expect(typeof tuple[1]).toBe("number");
        } else {
          expect(typeof value).toBe("number");
        }
      }
    });

    it("all numeric values are positive (except chargeStrength and tooltipY which are negative by design)", () => {
      // chargeStrength is negative (repulsive force in D3)
      // tooltipY is negative (positioned above the node)
      const negativeByDesign = new Set(["chargeStrength", "tooltipY"]);

      for (const [key, value] of Object.entries(GRAPH)) {
        if (key === "zoomExtent") {
          const tuple = value as [number, number];
          expect(tuple[0]).toBeGreaterThan(0);
          expect(tuple[1]).toBeGreaterThan(0);
        } else if (negativeByDesign.has(key)) {
          expect(typeof value).toBe("number");
          expect(value as number).not.toBe(0);
        } else {
          expect(value as number).toBeGreaterThan(0);
        }
      }
    });

    it("zoomExtent[0] < zoomExtent[1]", () => {
      expect(GRAPH.zoomExtent[0]).toBeLessThan(GRAPH.zoomExtent[1]);
    });

    it("nodeRadius < glowRingRadius < collideRadius", () => {
      expect(GRAPH.nodeRadius).toBeLessThan(GRAPH.glowRingRadius);
      expect(GRAPH.glowRingRadius).toBeLessThan(GRAPH.collideRadius);
    });
  });
});
