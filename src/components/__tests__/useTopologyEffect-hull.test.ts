import { describe, it, expect } from "vitest";
import { GRAPH } from "@/lib/config";
import { clusterHullPath, clusterLabelAnchor } from "../AgentGraph/useTopologyEffect";

/**
 * Direct unit tests for the cluster-hull geometry helpers extracted from the
 * team/workflow copy-paste pair in useTopologyEffect's tick handler. These
 * pin down the exact path/anchor math both cluster types now share.
 */

const PAD = GRAPH.collideRadius;

describe("clusterHullPath", () => {
  it("returns '' when no hull can be drawn (0 or 1 points)", () => {
    expect(clusterHullPath([])).toBe("");
    expect(clusterHullPath([[10, 20]])).toBe("");
  });

  it("renders exactly 2 points as a padded ellipse path", () => {
    const points: [number, number][] = [[0, 0], [100, 40]];
    const cx = 50;
    const cy = 20;
    const rx = 50 + PAD;
    const ry = 20 + PAD;
    expect(clusterHullPath(points)).toBe(
      `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`,
    );
  });

  it("renders 3+ points as a closed hull expanded outward by the pad", () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const d = clusterHullPath(square);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);

    // Each hull vertex moves PAD further from the centroid (50, 50).
    const vertices = d.slice(1, -1).split("L").map((p) => p.split(",").map(Number));
    expect(vertices).toHaveLength(4);
    const cornerDist = Math.sqrt(50 * 50 + 50 * 50);
    for (const [x, y] of vertices) {
      const dist = Math.sqrt((x - 50) ** 2 + (y - 50) ** 2);
      expect(dist).toBeCloseTo(cornerDist + PAD, 6);
    }
  });

});

describe("clusterLabelAnchor", () => {
  it("centers x over the points and floats y above the topmost point", () => {
    const points: [number, number][] = [[0, 50], [100, 10], [200, 90]];
    const anchor = clusterLabelAnchor(points);
    expect(anchor.x).toBe(100); // (0 + 100 + 200) / 3
    expect(anchor.y).toBe(10 - PAD - 8); // min-Y point, padded upward
  });

  it("falls back to y = 0 when there are no positioned points", () => {
    const anchor = clusterLabelAnchor([]);
    expect(anchor.y).toBe(-PAD - 8);
  });
});
