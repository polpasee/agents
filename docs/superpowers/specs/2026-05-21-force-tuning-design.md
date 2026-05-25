# Force Tuning: Bounded Charge + Wider Sub-Agent Links + Stable Centering + Per-Node Collision

**Date:** 2026-05-21
**Status:** Approved, ready for implementation
**Scope:** Four force-simulation tweaks aligned with the d3 force-directed
tree pattern. 1 config value change, 2 new constants, 1 import line, ~6
lines net in the simulation builder.

## Problems

The agent topology graph (`src/components/AgentGraph/useTopologyEffect.ts`)
runs a force-directed simulation with four forces: `link`, `charge`,
`center`, `collide`. Four layout issues:

### Problem 1: Main↔Main spacing drifts unbounded as nodes appear

`forceManyBody<SimNode>()` at `useTopologyEffect.ts:242` is called with no
arguments: default strength −30, default `distanceMax` Infinity. Every
node repels every other node across the entire canvas.

Tool nodes get pushed into the same simulation by
`useToolNodesEffect.ts:79`:
```ts
simulation.nodes([...refs.nodesRef.current, ...newToolNodes]);
```

So every new sub-agent and every transient tool node adds −30 repulsion
against every main. The main↔main link distance of 300 sets a *target*,
not a ceiling — link force can't fight accumulating charge. As children
appear, mains drift further apart.

A previous fix (memory: `"distanceMax cap applied d3-force ... Main↔Main
spacing bounded; was unbounded w/ agent count"`) is not present in current
code — either reverted or never merged.

### Problem 2: Sub-agents crowd their main

With `subAgentLinkDistance: 100`, sub-agents settle ~150-180px from their
parent main once charge spreads them out. Together with tool nodes
(`toolLinkDistance: 80`) orbiting each sub-agent, the cluster around each
main gets tight enough that tool circles can overlap a sibling sub-agent
or the main hex itself.

### Problem 3: Sub-agents and tools collide as if they were mains

`forceCollide` at `useTopologyEffect.ts:244` uses a hardcoded
`GRAPH.nodeRadius + 4` (46px) for every node. But sub-agents render at
`subAgentNodeRadius: 28` and tool nodes at `toolNodeRadius: 14`. So a
14px tool node punches above its weight, pushing other nodes 46px away as
if it were a full-size main hex. This makes the cluster around each main
artificially loose — and contributes to the perceived crowding the
`subAgentLinkDistance` bump in Fix 2 tries to compensate for.

### Problem 4: Centering "wanders" with asymmetric trees

`forceCenter(w/2, h/2)` at `useTopologyEffect.ts:243` rebalances the
centroid each tick but applies no per-node pull. With asymmetric trees
(one main with many children, another with few), the centroid recomputes
constantly as children appear/disappear, causing visible drift of the
whole graph relative to the canvas viewport. The `@d3/force-directed-tree`
pattern uses weak `forceX`/`forceY` instead, which actively pulls every
node toward an anchor — more stable under add/remove churn.

## Non-Goals

- **Hierarchy rings via `forceRadial`** — initially considered, dropped.
  `forceRadial` uses one fixed center for the whole simulation. With ≥2
  main agents, sub-agents from different mains would be pulled to a single
  shared ring around canvas center, mixing siblings. Worse than current
  behavior. The natural "ring around parent" effect already happens for
  free via link distance + charge.

## Approach

### Fix 1: `.distanceMax()` on charge

Cap the charge force's reach at 500px. Nodes within 500px still repel
each other; anything beyond contributes zero force. This bounds the
cumulative push on main nodes regardless of how many sub-agents or tools
appear elsewhere in the graph.

Default charge strength (−30) is kept — only the *reach* is bounded. This
preserves local repulsion (anti-overlap, gentle spread) while eliminating
long-range drift.

### Fix 2: Widen `subAgentLinkDistance`

Increase `subAgentLinkDistance` from 100 to 320. Gives each sub-agent
substantial breathing room around its main; tool rings from one sub-agent
won't touch the main hex.

### Fix 3: Per-node collision radius

Replace the hardcoded `forceCollide.radius(GRAPH.nodeRadius + 4)` with a
function that returns the correct radius per node type:

- Tool nodes (`d.toolCall` set) → `toolNodeRadius + 4` (18px)
- Sub-agents (via `getNodeRadius(d.agent)`) → 32px
- Mains (via `getNodeRadius(d.agent)`) → 46px

Each node now collides at its true visual size. Tools stop punching above
their weight; sub-agents pack closer to their parent main without false
collision pressure from oversized footprints.

### Fix 4: Replace `forceCenter` with weak `forceX` + `forceY`

Swap the centroid-shifting `forceCenter` for per-node `forceX(w/2)` +
`forceY(h/2)` at weak strength (0.05). Every node gently pulls toward the
viewport center, so the graph stays anchored as children appear and
disappear. This is the `@d3/force-directed-tree` centering pattern.

## Implementation

### 1. `src/lib/config.ts`

Change one value and add one new constant in the `GRAPH` block (around
lines 29-31, next to other layout parameters):

```ts
subAgentLinkDistance: 320,  // was 100 — more room around mains for sub-agents and their tool rings
chargeDistanceMax: 500,     // NEW — cap charge force reach to bound main↔main drift
centerStrength: 0.05,       // NEW — per-node pull toward viewport center (replaces forceCenter)
```

### 2. `src/components/AgentGraph/useTopologyEffect.ts`

Update the `d3-force` import at line 5 (drop `forceCenter`, add `forceX`/`forceY`):

```ts
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from "d3-force";
```

Update the config import at line 8 to also pull `getNodeRadius`:

```ts
import { GRAPH, getNodeRadius } from "@/lib/config";
```

Replace the charge, center, and collide lines (`useTopologyEffect.ts:242-244`):

```ts
// before
.force("charge", forceManyBody<SimNode>())
.force("center", forceCenter(width / 2, height / 2))
.force("collide", forceCollide<SimNode>().radius(GRAPH.nodeRadius + 4))

// after
.force("charge", forceManyBody<SimNode>().distanceMax(GRAPH.chargeDistanceMax))
.force("x", forceX<SimNode>(width / 2).strength(GRAPH.centerStrength))
.force("y", forceY<SimNode>(height / 2).strength(GRAPH.centerStrength))
.force("collide", forceCollide<SimNode>().radius((d) =>
  d.toolCall ? GRAPH.toolNodeRadius + 4 : getNodeRadius(d.agent) + 4,
))
```

The `link` force above is unchanged.

## Trade-off Decisions (made during design)

| Decision | Value chosen | Reason |
|---|---|---|
| Charge `distanceMax` | 500px | Repulsion still operates across full local cluster (main + sub-agents + tools within ~500px); distant siblings beyond that contribute zero force. Wider than 300 to keep local spread natural; tighter than Infinity to stop drift. |
| Charge `strength` | Default (−30, unchanged) | `distanceMax` alone fixes drift. Reducing strength further risks node overlap. Tune later if needed. |
| `subAgentLinkDistance` | 320 (was 100) | Substantial breathing room; tool rings from one sub-agent won't touch the main hex. Comfortable for 4-8 sub-agents per main. Trade-off: at 10+ sub-agents per main, neighbors' tool rings may begin overlapping on the outer arc — revisit if that becomes common. |
| Collide radius | Per-node (via `getNodeRadius` + `toolCall` discriminator) | Honors each node's visual size — tools 14+4, sub-agents 28+4, mains 42+4. Stops tools from pushing other nodes around as if they were 46px mains. Reuses existing `getNodeRadius` helper for consistency. |
| Collide padding | 4px (unchanged) | Matches the original hardcoded `+4`. Small enough to keep clusters tight, large enough to prevent visual touch between adjacent hexes. |
| `centerStrength` | 0.05 | Weak enough that link + charge still dominate local layout, strong enough to keep the graph anchored under churn. Default `forceX/Y` strength is 0.1; halving gives noticeably gentler anchoring. |
| `forceCenter` → `forceX/Y` | Swapped | `@d3/force-directed-tree` pattern. Per-node anchor is stable under add/remove churn; centroid rebalancing is not. |
| `forceRadial` | Dropped | Single-center force breaks the multi-main case by mixing siblings. Natural ring-around-parent already emerges from link + charge. |

## Out of Scope

- **Hierarchy stratification with a force** — see Non-Goals.
- **Team clustering** (forceX/forceY by team) — separate layout goal.
- **Tool nodes' positioning parameters** — `toolLinkDistance` (80px) is
  untouched. They share the main simulation and benefit from bounded
  charge and right-sized collision automatically.

## Verification

1. `npm run typecheck` — passes.
2. `npm test` — existing tests pass (visual layout tweak, no behavioral
   change).
3. Manual (matches the user's screenshot scenario):
   - Register one main with 6+ sub-agents, each with 1-2 tool calls.
     Confirm sub-agents sit further from the main than before; tool
     rings around sub-agents don't visually crowd the main hex.
   - Add a second main. Confirm the two mains settle at ~300px apart
     (the main↔main link distance) regardless of how many sub-agents
     each one has.
   - Add 10 more sub-agents and many tool calls under one main. Confirm
     main↔main distance stays roughly constant (does not grow with child
     count) — this is the drift fix.
   - With an asymmetric tree (e.g., one main with 8 children, another
     with 1), add and remove a sub-agent under the busy main. The whole
     graph should not visibly slide across the canvas — this is the
     centering-stability fix.
   - Visually inspect tool nodes: they should sit close to their parent
     sub-agent (within ~tool-link distance + small collide padding) and
     should not push the parent main or sibling sub-agents away — this
     is the per-node collision fix.

## Files Changed

- `src/lib/config.ts` — change 1 value, add 2 constants.
- `src/components/AgentGraph/useTopologyEffect.ts` — update 2 imports
  (`d3-force`, `@/lib/config`), replace 3 force lines with 4 (charge,
  collide modified in place; `center` swapped for `x` + `y`).

Total: ~7 lines net across 2 files.
