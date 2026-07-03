import { describe, it, expect } from "vitest";
import type { SimulationNodeDatum } from "d3-force";
import { forceRadialSpokes } from "../radialSpokes";

type TestNode = SimulationNodeDatum & { id: string };

function node(id: string, x: number, y: number): TestNode {
  return { id, x, y, vx: 0, vy: 0 };
}

function integrate(
  children: TestNode[],
  force: (a: number) => void,
  steps = 300,
) {
  for (let s = 0; s < steps; s++) {
    force(1);
    for (const c of children) {
      c.x = (c.x ?? 0) + (c.vx ?? 0);
      c.y = (c.y ?? 0) + (c.vy ?? 0);
      c.vx = (c.vx ?? 0) * 0.6;
      c.vy = (c.vy ?? 0) * 0.6;
    }
  }
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
    ).arcSpan(2 * Math.PI); // full circle, forced explicitly
    force.initialize(all);
    integrate(children, force);

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

  it("arcSpan() getter returns undefined by default, then the set value", () => {
    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      () => undefined,
      () => 100,
    );
    expect(force.arcSpan()).toBeUndefined();
    const result = force.arcSpan(Math.PI / 2);
    expect(result).toBe(force); // setter chains
    expect(force.arcSpan()).toBe(Math.PI / 2);
  });

  it("fans a 2-child root group into an arc (both children above the parent), not one-up/one-down", () => {
    // Forcing arcSpan=π centers the root fan on straight-up (-π/2), so a
    // 2-child group should land with BOTH children above the parent instead
    // of the full-circle default's one-up/one-down split.
    const parent = node("P", 0, 0);
    const children = [node("C1", 10, 0), node("C2", -10, 0)];
    const all = [parent, ...children];
    const RADIUS = 100;

    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      (n) => (n.id === "P" ? undefined : "P"),
      () => RADIUS,
    ).arcSpan(Math.PI);
    force.initialize(all);
    integrate(children, force);

    for (const c of children) {
      expect(c.y ?? 0).toBeLessThan(parent.y ?? 0);
    }
  });

  it("with arcSpan unset, fans a 2-child root group into a full circle (opposite sides, not both above)", () => {
    // Unset arcSpan defaults a root group (no grandparent) to 2π, so a
    // 2-child group settles on opposite sides of the parent — this is the
    // behavior the toolSpokes force relies on to preserve the full-circle
    // tool ring around main agents.
    const parent = node("P", 0, 0);
    const children = [node("C1", 10, 0), node("C2", -10, 0)];
    const all = [parent, ...children];
    const RADIUS = 100;

    const force = forceRadialSpokes<TestNode>(
      (n) => n.id,
      (n) => (n.id === "P" ? undefined : "P"),
      () => RADIUS,
    );
    force.initialize(all);
    integrate(children, force);

    const xs = children.map((c) => c.x ?? 0).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(0);
    expect(xs[1]).toBeGreaterThan(0);
    for (const c of children) {
      expect(Math.abs(c.y ?? 0)).toBeLessThan(1);
    }
  });

  it("arcSpan() widens or narrows the angular spread between children", () => {
    function angularGapFor(spanValue: number): number {
      const parent = node("P", 0, 0);
      const children = [node("C1", 10, 0), node("C2", -10, 0)];
      const all = [parent, ...children];
      const force = forceRadialSpokes<TestNode>(
        (n) => n.id,
        (n) => (n.id === "P" ? undefined : "P"),
        () => 100,
      ).arcSpan(spanValue);
      force.initialize(all);
      integrate(children, force);
      const angles = children.map((c) => Math.atan2(c.y ?? 0, c.x ?? 0));
      let gap = Math.abs(angles[1]! - angles[0]!);
      if (gap > Math.PI) gap = 2 * Math.PI - gap;
      return gap;
    }

    const narrow = angularGapFor(Math.PI / 2);
    const wide = angularGapFor(Math.PI);
    expect(wide).toBeGreaterThan(narrow);
  });
});

type TestNodeWithParent = SimulationNodeDatum & {
  id: string;
  parentId?: string;
};

function nodeP(
  id: string,
  x: number,
  y: number,
  parentId?: string,
): TestNodeWithParent {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

describe("forceRadialSpokes — outward fan with grandparent", () => {
  it("fans 3 inner-seeded children outward past the parent (no child stays on inner side)", () => {
    // G at origin, P at (100, 0) — outward direction is +x (angle 0).
    // Children seeded at x=90 (< P.x=100) so a no-op force leaves them
    // there; the outward fan must push every child past x=100.
    const G = nodeP("G", 0, 0);
    const P = nodeP("P", 100, 0, "G");
    const C1 = nodeP("C1", 90, 8, "P");
    const C2 = nodeP("C2", 90, 0, "P");
    const C3 = nodeP("C3", 90, -8, "P");
    const children = [C1, C2, C3];
    const all = [G, P, ...children];
    const RADIUS = 40;

    // grandparentIdOf: for C1/C2/C3 whose parent is P, grandparent = P.parentId = G.
    const force = forceRadialSpokes<TestNodeWithParent>(
      (n) => n.id,
      (n) => n.parentId,
      () => RADIUS,
      (parent) => parent.parentId,
    );
    force.initialize(all);
    integrate(children, force);

    // Every child must end up strictly on the outer side of P.
    for (const c of children) {
      expect(c.x).toBeGreaterThan(P.x ?? 100);
    }

    // Fan is symmetric about the x-axis: sum of y-coordinates ≈ 0.
    const sumY = children.reduce((s, c) => s + (c.y ?? 0), 0);
    expect(Math.abs(sumY)).toBeLessThan(5);
  });

  it("fans a single inner-seeded child outward, not up/down as full-circle n=1 would", () => {
    // G at origin, P at (100, 0). One child seeded inner at (90, 0).
    // Full-circle n=1 targets angle -π/2 → tx=100, ty=-R (child.x stays ≈100, not >100).
    // Outward arc n=1 targets angle 0 → tx=140, ty=0 (child.x → ~140 > 100).
    const G = nodeP("G", 0, 0);
    const P = nodeP("P", 100, 0, "G");
    const C = nodeP("C", 90, 0, "P");
    const RADIUS = 40;

    const force = forceRadialSpokes<TestNodeWithParent>(
      (n) => n.id,
      (n) => n.parentId,
      () => RADIUS,
      (parent) => parent.parentId,
    );
    force.initialize([G, P, C]);
    integrate([C], force);

    expect(C.x).toBeGreaterThan(P.x ?? 100);
    expect(Math.abs(C.y ?? 0)).toBeLessThan(1);
  });
});
