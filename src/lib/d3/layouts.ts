import * as d3 from "d3";

interface LayoutNode {
  id: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  agent: { parentId?: string };
}

interface LayoutLink {
  source: string | LayoutNode;
  target: string | LayoutNode;
}

/**
 * Build a d3.hierarchy from flat nodes + edges.
 * If there are multiple roots (no parentId), a virtual root is created.
 */
function buildHierarchy(nodes: LayoutNode[], _edges: LayoutLink[]) {
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

  function toHierNode(node: LayoutNode): HierNode {
    const children = childrenMap.get(node.id);
    return {
      id: node.id,
      realNode: node,
      children: children ? children.map(toHierNode) : undefined,
    };
  }

  let root: HierNode;
  if (roots.length === 1) {
    root = toHierNode(roots[0]);
  } else if (roots.length === 0) {
    root = { id: "__virtual_root__", realNode: null };
  } else {
    root = {
      id: "__virtual_root__",
      realNode: null,
      children: roots.map(toHierNode),
    };
  }

  return d3
    .hierarchy<HierNode>(root)
    .sum(() => 1);
}

/** Top-down tree layout using d3.tree(). */
export function applyTreeLayout(
  nodes: LayoutNode[],
  edges: LayoutLink[],
  width: number,
  height: number
): void {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    nodes[0].fx = width / 2;
    nodes[0].fy = height / 2;
    return;
  }

  const hier = buildHierarchy(nodes, edges);
  const treeLayout = d3.tree<ReturnType<typeof buildHierarchy> extends d3.HierarchyNode<infer T> ? T : never>()
    .size([width * 0.8, height * 0.7]);

  treeLayout(hier);

  const offsetX = width * 0.1;
  const offsetY = height * 0.1;

  hier.each((d) => {
    if (d.data.realNode) {
      d.data.realNode.fx = (d.x ?? 0) + offsetX;
      d.data.realNode.fy = (d.y ?? 0) + offsetY;
    }
  });
}

/** Radial layout: d3.tree() with polar coordinate projection. */
export function applyRadialLayout(
  nodes: LayoutNode[],
  edges: LayoutLink[],
  width: number,
  height: number
): void {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    nodes[0].fx = width / 2;
    nodes[0].fy = height / 2;
    return;
  }

  const hier = buildHierarchy(nodes, edges);
  const radius = Math.min(width, height) * 0.35;
  const treeLayout = d3.tree<ReturnType<typeof buildHierarchy> extends d3.HierarchyNode<infer T> ? T : never>()
    .size([2 * Math.PI, radius]);

  treeLayout(hier);

  const cx = width / 2;
  const cy = height / 2;

  hier.each((d) => {
    if (d.data.realNode) {
      const angle = d.x ?? 0;
      const r = d.y ?? 0;
      d.data.realNode.fx = cx + r * Math.cos(angle - Math.PI / 2);
      d.data.realNode.fy = cy + r * Math.sin(angle - Math.PI / 2);
    }
  });
}

/** Hierarchical layout: left-to-right layered. */
export function applyHierarchicalLayout(
  nodes: LayoutNode[],
  edges: LayoutLink[],
  width: number,
  height: number
): void {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    nodes[0].fx = width / 2;
    nodes[0].fy = height / 2;
    return;
  }

  const hier = buildHierarchy(nodes, edges);
  const treeLayout = d3.tree<ReturnType<typeof buildHierarchy> extends d3.HierarchyNode<infer T> ? T : never>()
    .size([height * 0.8, width * 0.7]);

  treeLayout(hier);

  const offsetX = width * 0.1;
  const offsetY = height * 0.1;

  hier.each((d) => {
    if (d.data.realNode) {
      d.data.realNode.fx = (d.y ?? 0) + offsetX;
      d.data.realNode.fy = (d.x ?? 0) + offsetY;
    }
  });
}
