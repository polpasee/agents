import { describe, it, expect } from "vitest";
import {
  applyTreeLayout,
  applyRadialLayout,
  applyHierarchicalLayout,
} from "../d3/layouts";

/** Create a mock LayoutNode compatible with the layouts module interface */
function mockNode(
  id: string,
  parentId?: string,
): {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  agent: { parentId?: string };
} {
  return {
    id,
    x: 0,
    y: 0,
    fx: null,
    fy: null,
    agent: { parentId },
  };
}

const WIDTH = 800;
const HEIGHT = 600;

describe("applyTreeLayout", () => {
  it("does not throw with an empty array", () => {
    expect(() => applyTreeLayout([], [], WIDTH, HEIGHT)).not.toThrow();
  });

  it("sets fx/fy on a single node", () => {
    const node = mockNode("a");
    applyTreeLayout([node], [], WIDTH, HEIGHT);
    expect(node.fx).toBe(WIDTH / 2);
    expect(node.fy).toBe(HEIGHT / 2);
  });

  it("sets fx/fy on multiple nodes", () => {
    const parent = mockNode("parent");
    const child = mockNode("child", "parent");
    applyTreeLayout([parent, child], [], WIDTH, HEIGHT);
    expect(parent.fx).toBeTypeOf("number");
    expect(parent.fy).toBeTypeOf("number");
    expect(child.fx).toBeTypeOf("number");
    expect(child.fy).toBeTypeOf("number");
  });

  it("positions parent above child (lower fy)", () => {
    const parent = mockNode("parent");
    const child = mockNode("child", "parent");
    applyTreeLayout([parent, child], [], WIDTH, HEIGHT);
    // Tree layout is top-down, so parent fy < child fy
    expect(parent.fy!).toBeLessThan(child.fy!);
  });
});

describe("applyRadialLayout", () => {
  it("does not throw with an empty array", () => {
    expect(() => applyRadialLayout([], [], WIDTH, HEIGHT)).not.toThrow();
  });

  it("sets fx/fy on a single node", () => {
    const node = mockNode("a");
    applyRadialLayout([node], [], WIDTH, HEIGHT);
    expect(node.fx).toBe(WIDTH / 2);
    expect(node.fy).toBe(HEIGHT / 2);
  });

  it("sets fx/fy on multiple nodes", () => {
    const parent = mockNode("root");
    const child1 = mockNode("c1", "root");
    const child2 = mockNode("c2", "root");
    applyRadialLayout([parent, child1, child2], [], WIDTH, HEIGHT);
    expect(parent.fx).toBeTypeOf("number");
    expect(parent.fy).toBeTypeOf("number");
    expect(child1.fx).toBeTypeOf("number");
    expect(child1.fy).toBeTypeOf("number");
  });
});

describe("applyHierarchicalLayout", () => {
  it("does not throw with an empty array", () => {
    expect(() =>
      applyHierarchicalLayout([], [], WIDTH, HEIGHT),
    ).not.toThrow();
  });

  it("sets fx/fy on a single node", () => {
    const node = mockNode("a");
    applyHierarchicalLayout([node], [], WIDTH, HEIGHT);
    expect(node.fx).toBe(WIDTH / 2);
    expect(node.fy).toBe(HEIGHT / 2);
  });

  it("sets fx/fy on multiple nodes", () => {
    const parent = mockNode("parent");
    const child = mockNode("child", "parent");
    applyHierarchicalLayout([parent, child], [], WIDTH, HEIGHT);
    expect(parent.fx).toBeTypeOf("number");
    expect(parent.fy).toBeTypeOf("number");
    expect(child.fx).toBeTypeOf("number");
    expect(child.fy).toBeTypeOf("number");
  });

  it("positions parent left of child (lower fx)", () => {
    const parent = mockNode("parent");
    const child = mockNode("child", "parent");
    applyHierarchicalLayout([parent, child], [], WIDTH, HEIGHT);
    // Hierarchical is left-to-right, parent fx < child fx
    expect(parent.fx!).toBeLessThan(child.fx!);
  });
});
