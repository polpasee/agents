import { hierarchy, tree } from "d3-hierarchy";
import type { HierarchyNode } from "d3-hierarchy";

interface LayoutNode {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  agent: { parentId?: string };
}

/**
 * Build a d3.hierarchy from flat nodes (parent links come from agent.parentId).
 * If there are multiple roots (no parentId), a virtual root is created.
 */
function buildHierarchy(nodes: LayoutNode[]) {
  const nodeMap = new Map<string, LayoutNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const roots = nodes.filter(
    (n) => !n.agent.parentId || !nodeMap.has(n.agent.parentId)
  );

  const childrenMap = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    if (n.agent.parentId && nodeMap.has(n.agent.parentId)) {
      const siblings = childrenMap.get(n.agent.parentId) || [];
      siblings.push(n);
      childrenMap.set(n.agent.parentId, siblings);
    }
  }

  interface HierNode {
    id: string;
    realNode: LayoutNode | null;
    children?: HierNode[];
  }

  // Guard against cycles in the parent chain: a malformed session could produce
  // an agent whose parentId transitively points back to itself, which would cause
  // unbounded recursion here.
  function toHierNode(node: LayoutNode, visited: Set<string>): HierNode {
    if (visited.has(node.id)) {
      return { id: node.id, realNode: node };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(node.id);
    const children = childrenMap.get(node.id);
    return {
      id: node.id,
      realNode: node,
      children: children ? children.map((c) => toHierNode(c, nextVisited)) : undefined,
    };
  }

  let root: HierNode;
  if (roots.length === 1) {
    root = toHierNode(roots[0], new Set());
  } else if (roots.length === 0) {
    root = { id: "__virtual_root__", realNode: null };
  } else {
    root = {
      id: "__virtual_root__",
      realNode: null,
      children: roots.map((r) => toHierNode(r, new Set())),
    };
  }

  return hierarchy<HierNode>(root)
    .sum(() => 1);
}

type HierNodeData = ReturnType<typeof buildHierarchy> extends HierarchyNode<infer T> ? T : never;

/**
 * Shared tree-based layout engine. The three public layout functions delegate
 * to this with different size/project callbacks so the hierarchy build and
 * tree traversal are not duplicated.
 *
 * @param nodes  - flat list of layout nodes (mutated: fx/fy are set)
 * @param width  - canvas width
 * @param height - canvas height
 * @param sizer  - returns [treeWidth, treeHeight] passed to d3.tree().size()
 * @param project - maps (d.x, d.y, width, height) → { fx, fy } on each node
 */
function applyTreeBasedLayout(
  nodes: LayoutNode[],
  width: number,
  height: number,
  sizer: (width: number, height: number) => [number, number],
  project: (dx: number, dy: number, width: number, height: number) => { fx: number; fy: number },
): void {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    nodes[0].fx = width / 2;
    nodes[0].fy = height / 2;
    return;
  }

  const hier = buildHierarchy(nodes);
  const treeLayout = tree<HierNodeData>().size(sizer(width, height));
  treeLayout(hier);

  hier.each((d) => {
    if (d.data.realNode) {
      const pos = project(d.x ?? 0, d.y ?? 0, width, height);
      d.data.realNode.fx = pos.fx;
      d.data.realNode.fy = pos.fy;
    }
  });
}

/** Top-down tree layout using d3.tree(). */
export function applyTreeLayout(
  nodes: LayoutNode[],
  width: number,
  height: number
): void {
  applyTreeBasedLayout(
    nodes,
    width,
    height,
    (w, h) => [w * 0.8, h * 0.7],
    (dx, dy, w, h) => ({ fx: dx + w * 0.1, fy: dy + h * 0.1 }),
  );
}

/** Radial layout: d3.tree() with polar coordinate projection. */
export function applyRadialLayout(
  nodes: LayoutNode[],
  width: number,
  height: number
): void {
  const radius = Math.min(width, height) * 0.35;
  applyTreeBasedLayout(
    nodes,
    width,
    height,
    () => [2 * Math.PI, radius],
    (dx, dy, w, h) => {
      const angle = dx;
      const r = dy;
      return {
        fx: w / 2 + r * Math.cos(angle - Math.PI / 2),
        fy: h / 2 + r * Math.sin(angle - Math.PI / 2),
      };
    },
  );
}

/** Hierarchical layout: left-to-right layered. */
export function applyHierarchicalLayout(
  nodes: LayoutNode[],
  width: number,
  height: number
): void {
  applyTreeBasedLayout(
    nodes,
    width,
    height,
    (w, h) => [h * 0.8, w * 0.7],
    (dx, dy, w, h) => ({ fx: dy + w * 0.1, fy: dx + h * 0.1 }),
  );
}
