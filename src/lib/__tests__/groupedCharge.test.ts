import { describe, it, expect } from "vitest";
import type { SimulationNodeDatum } from "d3-force";
import { forceGroupedManyBody } from "../d3/groupedCharge";

type TestNode = SimulationNodeDatum & { id: string; groups: string[] };

function node(id: string, x: number, y: number, groups: string[]): TestNode {
  return { id, x, y, vx: 0, vy: 0, groups };
}

function run(nodes: TestNode[], strength = -30, distanceMax?: number) {
  let force = forceGroupedManyBody<TestNode>((n) => n.groups).strength(() => strength);
  if (distanceMax !== undefined) force = force.distanceMax(distanceMax);
  force.initialize(nodes);
  force(1); // one tick at alpha = 1
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("forceGroupedManyBody", () => {
  it("repels two nodes that share a bucket (pushes them apart)", () => {
    const a = node("a", 0, 0, ["g1"]);
    const b = node("b", 10, 0, ["g1"]);
    run([a, b]);
    // a sits left of b → a accelerates left (negative), b accelerates right.
    expect(a.vx!).toBeLessThan(0);
    expect(b.vx!).toBeGreaterThan(0);
    // Newton's third law: equal and opposite for equal strengths.
    expect(a.vx!).toBeCloseTo(-b.vx!);
  });

  it("does NOT affect nodes in different buckets", () => {
    const a = node("a", 0, 0, ["g1"]);
    const b = node("b", 10, 0, ["g2"]);
    run([a, b]);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it("scopes repulsion through shared buckets only (multi-membership)", () => {
    // A↔B share g1, B↔C share g2, A↔C share nothing.
    const a = node("a", 0, 0, ["g1"]);
    const b = node("b", 10, 0, ["g1", "g2"]);
    const c = node("c", 20, 0, ["g2"]);
    run([a, b, c]);
    expect(a.vx).not.toBe(0); // felt B
    expect(c.vx).not.toBe(0); // felt B
    // A and C never share a bucket; A is left of B so it must be pushed left,
    // never right (which is the only direction C could push it).
    expect(a.vx!).toBeLessThan(0);
    expect(c.vx!).toBeGreaterThan(0);
  });

  it("ignores pairs beyond distanceMax", () => {
    const a = node("a", 0, 0, ["g1"]);
    const b = node("b", 1000, 0, ["g1"]);
    run([a, b], -30, 500);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it("exposes strength and distanceMax getters and chains the setters", () => {
    const accessor = () => -42;
    const force = forceGroupedManyBody<TestNode>((n) => n.groups);
    expect(force.strength(accessor)).toBe(force); // setter chains
    expect(force.strength()).toBe(accessor); // getter returns accessor
    expect(force.distanceMax(500)).toBe(force);
    expect(force.distanceMax()).toBe(500);
  });

  it("recomputes buckets when re-initialized with a new node set", () => {
    const a = node("a", 0, 0, ["g1"]);
    const b = node("b", 10, 0, ["g1"]);
    const force = forceGroupedManyBody<TestNode>((n) => n.groups).strength(() => -30);
    force.initialize([a]); // b not in the simulation yet
    force(1);
    expect(a.vx).toBe(0); // alone in its bucket
    force.initialize([a, b]); // b joins
    force(1);
    expect(a.vx).not.toBe(0);
  });
});
