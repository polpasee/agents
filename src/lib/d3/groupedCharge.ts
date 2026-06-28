import type { SimulationNodeDatum } from "d3-force";

/**
 * A many-body (charge) force that acts ONLY between nodes sharing a group,
 * unlike d3's global `forceManyBody` where every node repels every other.
 *
 * Each node is assigned one or more string bucket keys via `groupsOf`; a node
 * repels only the peers it shares a bucket with. This lets a main agent plus
 * the sub-agents it spawned form an isolated cluster that fans out radially
 * without being shoved around by unrelated families.
 *
 * Membership is static for a given node set, so buckets are computed once in
 * `initialize()` and reused every tick. Within each bucket the repulsion is the
 * naive O(k²) form of d3's leaf-leaf calculation — buckets are small (a single
 * agent family), so no quadtree/Barnes-Hut approximation is needed.
 *
 * The `.strength()` / `.distanceMax()` accessors mirror d3's `forceManyBody`
 * API so this force is a drop-in replacement for the simulation's "charge".
 *
 * `groupsOf` must return at least one key per node; a node mapped to an empty
 * array joins no bucket and is excluded from all repulsion (neither pushes nor
 * is pushed).
 */
export interface GroupedManyBodyForce<N extends SimulationNodeDatum> {
  (alpha: number): void;
  initialize(nodes: N[]): void;
  strength(): (node: N) => number;
  strength(accessor: (node: N) => number): GroupedManyBodyForce<N>;
  distanceMax(): number;
  distanceMax(value: number): GroupedManyBodyForce<N>;
}

// Matches d3-force's jiggle: a tiny random nudge so coincident nodes separate.
function jiggle(): number {
  return (Math.random() - 0.5) * 1e-6;
}

export function forceGroupedManyBody<N extends SimulationNodeDatum>(
  groupsOf: (node: N) => string[],
): GroupedManyBodyForce<N> {
  let buckets: N[][] = [];
  let strength: (node: N) => number = () => -30;
  let distanceMax2 = Infinity;
  const distanceMin2 = 1;

  const force = ((alpha: number) => {
    for (const members of buckets) {
      for (let i = 0; i < members.length; i++) {
        const a = members[i]!;
        const ax = a.x ?? 0;
        const ay = a.y ?? 0;
        const sa = strength(a);
        for (let j = i + 1; j < members.length; j++) {
          const b = members[j]!;
          let x = (b.x ?? 0) - ax;
          let y = (b.y ?? 0) - ay;
          let l = x * x + y * y;
          if (l >= distanceMax2) continue;
          // Coincident on an axis → jiggle so the force has a direction.
          if (x === 0) {
            x = jiggle();
            l += x * x;
          }
          if (y === 0) {
            y = jiggle();
            l += y * y;
          }
          if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
          // `a` is pushed by `b`'s charge and vice-versa (Newton's third law).
          const wb = (strength(b) * alpha) / l;
          const wa = (sa * alpha) / l;
          a.vx = (a.vx ?? 0) + x * wb;
          a.vy = (a.vy ?? 0) + y * wb;
          b.vx = (b.vx ?? 0) - x * wa;
          b.vy = (b.vy ?? 0) - y * wa;
        }
      }
    }
  }) as GroupedManyBodyForce<N>;

  force.initialize = (nodes: N[]): void => {
    const map = new Map<string, N[]>();
    for (const node of nodes) {
      for (const key of groupsOf(node)) {
        const arr = map.get(key);
        if (arr) arr.push(node);
        else map.set(key, [node]);
      }
    }
    buckets = Array.from(map.values());
  };

  force.strength = ((accessor?: (node: N) => number) => {
    if (accessor === undefined) return strength;
    strength = accessor;
    return force;
  }) as GroupedManyBodyForce<N>["strength"];

  force.distanceMax = ((value?: number) => {
    if (value === undefined) return Math.sqrt(distanceMax2);
    distanceMax2 = value * value;
    return force;
  }) as GroupedManyBodyForce<N>["distanceMax"];

  return force;
}
