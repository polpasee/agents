import { describe, it, expect } from "vitest";
import type { SimulationNodeDatum } from "d3-force";
import { forceRadialSpokes } from "../radialSpokes";

type TestNode = SimulationNodeDatum & { id: string };

function node(id: string, x: number, y: number): TestNode {
  return { id, x, y, vx: 0, vy: 0 };
}

describe("forceRadialSpokes", () => {
  it("converges 4 children to even angular spacing around a fixed parent", () => {
    const parent = node("P", 0, 0);
    const children = [
      node("C1", 10, 5),
      node("C2", -10, 5),
      node("C3", 5, -10),
      node("C4", -5, -10),
    ];
    const all = [parent, ...children];
    const RADIUS = 160;

    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      (n) => (n.id === "P" ? undefined : "P"),
      () => RADIUS,
    );
    force.initialize(all);

    // Simple integrator: 300 iterations with velocity decay
    for (let step = 0; step < 300; step++) {
      force(1);
      for (const c of children) {
        c.x = (c.x ?? 0) + (c.vx ?? 0);
        c.y = (c.y ?? 0) + (c.vy ?? 0);
        c.vx = (c.vx ?? 0) * 0.6;
        c.vy = (c.vy ?? 0) * 0.6;
      }
      // parent stays pinned at origin
    }

    const angles = children
      .map((c) => Math.atan2(c.y ?? 0, c.x ?? 0))
      .sort((a, b) => a - b);

    // Each gap between consecutive sorted angles should be ~π/2
    const expectedGap = (2 * Math.PI) / 4;
    const tolerance = 0.2;
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length]!;
      let gap = next - angles[i]!;
      if (gap < 0) gap += 2 * Math.PI; // wrap-around for last pair
      expect(Math.abs(gap - expectedGap)).toBeLessThan(tolerance);
    }

    // Each child should be near the target radius
    for (const c of children) {
      const dist = Math.sqrt((c.x ?? 0) ** 2 + (c.y ?? 0) ** 2);
      expect(Math.abs(dist - RADIUS)).toBeLessThan(15);
    }
  });

  it("does not apply velocity to a root node (parentIdOf returns undefined)", () => {
    const root = node("root", 0, 0);
    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      () => undefined,
      () => 100,
    );
    force.initialize([root]);
    force(1);
    expect(root.vx).toBe(0);
    expect(root.vy).toBe(0);
  });

  it("does not apply velocity to a child whose parent is absent (orphan)", () => {
    const orphan = node("orphan", 50, 50);
    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      (n) => (n.id === "orphan" ? "missing-parent" : undefined),
      () => 100,
    );
    force.initialize([orphan]);
    force(1);
    expect(orphan.vx).toBe(0);
    expect(orphan.vy).toBe(0);
  });

  it("strength() getter returns the set value and default is 0.1", () => {
    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      () => undefined,
      () => 100,
    );
    expect(force.strength()).toBe(0.1);
    const result = force.strength(0.5);
    expect(result).toBe(force); // setter chains
    expect(force.strength()).toBe(0.5);
  });
});
