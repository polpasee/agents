import type { SimulationNodeDatum } from "d3-force";

/**
 * A radial spoke force that arranges each parent agent's direct children at
 * even angles around it, producing readable "spoke" layouts for hierarchical
 * agent families.
 *
 * Coexists with the grouped charge force (which handles general repulsion
 * within each family). This force is intentionally gentle so the rigid parent
 * forceLink still owns the orbit radius; the spoke force mainly determines
 * angle assignment so that children fan out evenly rather than clustering on
 * one side.
 *
 * Membership and angular slot order are fixed once in `initialize()`; each
 * child's angle follows from its slot index every tick. For root-level groups
 * (parent has no grandparent) the angle formula is `-π/2 + 2π·i/n`, giving
 * an even full-circle fan. Groups whose parent has a grandparent (per
 * `grandparentIdOf`) fan their children across a semicircular outward arc
 * (width `OUTWARD_ARC_SPAN`) centered away from the grandparent, so nested
 * children spread outward instead of wrapping back toward the root; root-level
 * groups keep the even full-circle fan. Coincident parent/grandparent
 * positions fall back to the full-circle formula.
 * Children are sorted by id for stable, deterministic slots across restarts.
 *
 * The `.strength()` accessor mirrors d3's force API conventions.
 */
export interface RadialSpokesForce<N extends SimulationNodeDatum> {
  (alpha: number): void;
  initialize(nodes: N[]): void;
  strength(): number;
  strength(value: number): RadialSpokesForce<N>;
}

export function forceRadialSpokes<N extends SimulationNodeDatum>(
  idOf: (node: N) => string,
  parentIdOf: (node: N) => string | undefined,
  radiusOf: (node: N) => number,
  grandparentIdOf?: (parent: N) => string | undefined,
): RadialSpokesForce<N> {
  // Width of the outward fan for groups whose parent has a grandparent. A
  // semicircle keeps every child strictly on the outer hemisphere.
  const OUTWARD_ARC_SPAN = Math.PI;

  let strength = 0.1;
  let groups: { parent: N; children: N[]; grandparent?: N }[] = [];

  const force = ((alpha: number) => {
    for (const { parent, children, grandparent } of groups) {
      const n = children.length;
      let base: number | undefined;
      if (grandparent !== undefined) {
        const dx = (parent.x ?? 0) - (grandparent.x ?? 0);
        const dy = (parent.y ?? 0) - (grandparent.y ?? 0);
        if (dx !== 0 || dy !== 0) base = Math.atan2(dy, dx);
      }
      for (let i = 0; i < n; i++) {
        const angle =
          base !== undefined
            ? base + OUTWARD_ARC_SPAN * ((i + 0.5) / n - 0.5)
            : -Math.PI / 2 + (2 * Math.PI * i) / n;
        const child = children[i]!;
        const R = radiusOf(child);
        const tx = (parent.x ?? 0) + R * Math.cos(angle);
        const ty = (parent.y ?? 0) + R * Math.sin(angle);
        child.vx = (child.vx ?? 0) + (tx - (child.x ?? 0)) * strength * alpha;
        child.vy = (child.vy ?? 0) + (ty - (child.y ?? 0)) * strength * alpha;
      }
    }
  }) as RadialSpokesForce<N>;

  force.initialize = (nodes: N[]): void => {
    const byId = new Map<string, N>();
    for (const node of nodes) {
      byId.set(idOf(node), node);
    }
    const childMap = new Map<string, N[]>();
    for (const node of nodes) {
      const parentId = parentIdOf(node);
      if (parentId === undefined) continue;
      if (!byId.has(parentId)) continue; // orphan — skip
      const arr = childMap.get(parentId);
      if (arr) arr.push(node);
      else childMap.set(parentId, [node]);
    }
    groups = [];
    for (const [parentId, children] of childMap) {
      const parent = byId.get(parentId)!;
      children.sort((a, b) => idOf(a).localeCompare(idOf(b)));
      const grandparentId = grandparentIdOf?.(parent);
      const grandparent =
        grandparentId !== undefined ? byId.get(grandparentId) : undefined;
      groups.push({
        parent,
        children,
        ...(grandparent !== undefined ? { grandparent } : {}),
      });
    }
  };

  force.strength = ((value?: number) => {
    if (value === undefined) return strength;
    strength = value;
    return force;
  }) as RadialSpokesForce<N>["strength"];

  return force;
}
