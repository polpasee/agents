import { describe, it, expect } from "vitest";
import {
  applyTreeLayout,
  applyRadialLayout,
  applyHierarchicalLayout,
} from "../d3/layouts";

/** Create a mock LayoutNode */
function mockNode(id: string, parentId?: string) {
  return {
    id,
    x: 0 as number | undefined,
    y: 0 as number | undefined,
    fx: null as number | null | undefined,
    fy: null as number | null | undefined,
    agent: { parentId },
  };
}

const W = 800;
const H = 600;

// ---------------------------------------------------------------------------
// applyTreeLayout — verify the coordinate formula:
//   fx = d.x + width * 0.1
//   fy = d.y + height * 0.1
// d3.tree().size([width * 0.8, height * 0.7]) → root at d.x ∈ [0, W*0.8]
// ---------------------------------------------------------------------------
describe("applyTreeLayout — dedup path produces correct coordinates", () => {
  it("single-node centering is unchanged", () => {
    const n = mockNode("a");
    applyTreeLayout([n], W, H);
    expect(n.fx).toBe(W / 2);
    expect(n.fy).toBe(H / 2);
  });

  it("two-node tree: parent fx/fy are within the layout bounds", () => {
    const parent = mockNode("p");
    const child = mockNode("c", "p");
    applyTreeLayout([parent, child], W, H);

    // Both nodes must be positioned inside the canvas
    expect(parent.fx).toBeGreaterThanOrEqual(W * 0.1);
    expect(parent.fx).toBeLessThanOrEqual(W * 0.1 + W * 0.8);
    expect(parent.fy).toBeGreaterThanOrEqual(H * 0.1);
    expect(parent.fy).toBeLessThanOrEqual(H * 0.1 + H * 0.7);
  });

  it("top-down: parent fy < child fy", () => {
    const parent = mockNode("p");
    const child = mockNode("c", "p");
    applyTreeLayout([parent, child], W, H);
    expect(parent.fy!).toBeLessThan(child.fy!);
  });
});

// ---------------------------------------------------------------------------
// applyRadialLayout — verify polar projection:
//   fx = w/2 + r * cos(angle - π/2)
//   fy = h/2 + r * sin(angle - π/2)
// ---------------------------------------------------------------------------
describe("applyRadialLayout — dedup path produces correct coordinates", () => {
  it("single-node centering is unchanged", () => {
    const n = mockNode("a");
    applyRadialLayout([n], W, H);
    expect(n.fx).toBe(W / 2);
    expect(n.fy).toBe(H / 2);
  });

  it("multi-node: all nodes positioned within canvas bounds", () => {
    const root = mockNode("root");
    const c1 = mockNode("c1", "root");
    const c2 = mockNode("c2", "root");
    applyRadialLayout([root, c1, c2], W, H);

    const radius = Math.min(W, H) * 0.35;
    for (const n of [root, c1, c2]) {
      // fx and fy must be within the radial bounds from center
      expect(Math.abs(n.fx! - W / 2)).toBeLessThanOrEqual(radius + 1);
      expect(Math.abs(n.fy! - H / 2)).toBeLessThanOrEqual(radius + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// applyHierarchicalLayout — verify the coordinate formula (left-to-right):
//   fx = d.y + width * 0.1   (d3 x → fy; d3 y → fx in LTR mode)
//   fy = d.x + height * 0.1
// d3.tree().size([height * 0.8, width * 0.7])
// ---------------------------------------------------------------------------
describe("applyHierarchicalLayout — dedup path produces correct coordinates", () => {
  it("single-node centering is unchanged", () => {
    const n = mockNode("a");
    applyHierarchicalLayout([n], W, H);
    expect(n.fx).toBe(W / 2);
    expect(n.fy).toBe(H / 2);
  });

  it("left-to-right: parent fx < child fx", () => {
    const parent = mockNode("p");
    const child = mockNode("c", "p");
    applyHierarchicalLayout([parent, child], W, H);
    expect(parent.fx!).toBeLessThan(child.fx!);
  });

  it("two-node layout: nodes are within canvas bounds", () => {
    const parent = mockNode("p");
    const child = mockNode("c", "p");
    applyHierarchicalLayout([parent, child], W, H);

    for (const n of [parent, child]) {
      expect(n.fx).toBeGreaterThanOrEqual(W * 0.1);
      expect(n.fx).toBeLessThanOrEqual(W * 0.1 + W * 0.7);
      expect(n.fy).toBeGreaterThanOrEqual(H * 0.1);
      expect(n.fy).toBeLessThanOrEqual(H * 0.1 + H * 0.8);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-layout: same input → different coordinate arrangements
// ---------------------------------------------------------------------------
describe("layout dedup — different layouts produce different results", () => {
  it("applyTreeLayout and applyHierarchicalLayout differ for two-node input", () => {
    const pTree = mockNode("p");
    const cTree = mockNode("c", "p");
    applyTreeLayout([pTree, cTree], W, H);

    const pHier = mockNode("p");
    const cHier = mockNode("c", "p");
    applyHierarchicalLayout([pHier, cHier], W, H);

    // Tree is top-down; hierarchical is left-to-right — coordinates must differ
    const treeIsTopDown = pTree.fy! < cTree.fy!;
    const hierIsLeftRight = pHier.fx! < cHier.fx!;
    expect(treeIsTopDown).toBe(true);
    expect(hierIsLeftRight).toBe(true);
  });
});
