# Force Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply four d3-force tweaks to stabilize and clean up the agent topology graph layout (bounded charge, wider main↔sub-agent links, per-node collision, stable centering via `forceX`/`forceY`).

**Architecture:** Two-file change. Add config constants in `src/lib/config.ts`; rewire the force simulation builder in `src/components/AgentGraph/useTopologyEffect.ts` to consume them. Aligned with the `@d3/force-directed-tree` pattern.

**Tech Stack:** TypeScript, React, `d3-force`, Vitest, ESLint, Next.js.

**Spec:** `docs/superpowers/specs/2026-05-21-force-tuning-design.md`

**Pre-existing state:** Both target files have uncommitted modifications when this plan was written (`git diff --stat` showed 8 insertions / 38 deletions across them). The engineer should `cat` or open both files fresh before editing so they're working from the actual current state, not from any code shown below as "before."

---

## File Structure

- `src/lib/config.ts` — central GRAPH config. Change one value, add two constants.
- `src/components/AgentGraph/useTopologyEffect.ts` — simulation builder. Update two imports, replace three force lines with four.
- `src/lib/__tests__/config.test.ts` — existing iteration tests automatically validate new GRAPH entries (numeric, positive). No new test code is needed for config.

No new files. No file splits.

---

## Task 1: Update GRAPH config constants

**Files:**
- Modify: `src/lib/config.ts` (the `GRAPH` block, around lines 13-46)
- Verify: `src/lib/__tests__/config.test.ts` (existing tests, no edits)

- [ ] **Step 1: Open and read the current `src/lib/config.ts`**

Open the file. Locate the `GRAPH` block (begins `export const GRAPH = {` near line 14).

Find these three lines:

```ts
linkDistance: 300, // Link distance (px) for Main↔Main edges (message/blocking/default)
subAgentLinkDistance: 100, // Link distance (px) for Main↔sub-agent parent edges
toolLinkDistance: 80, // Link distance (px) for any↔tool edges
```

- [ ] **Step 2: Change `subAgentLinkDistance` from 100 to 320 and add two new constants**

Replace those three lines with:

```ts
linkDistance: 300, // Link distance (px) for Main↔Main edges (message/blocking/default)
subAgentLinkDistance: 320, // Link distance (px) for Main↔sub-agent parent edges
toolLinkDistance: 80, // Link distance (px) for any↔tool edges
chargeDistanceMax: 500, // Cap (px) on forceManyBody reach — beyond this, charge contributes zero force (bounds main↔main drift)
centerStrength: 0.05, // Per-node strength for forceX/forceY pull toward viewport center
```

Order matters only for readability — keep the layout-parameter cluster contiguous.

- [ ] **Step 3: Run the existing config tests and confirm they pass**

Run: `npx vitest run src/lib/__tests__/config.test.ts`
Expected: PASS. The iteration tests (`all values are numbers`, `all numeric values are positive`) automatically validate the two new constants — no test file edit needed.

If a test fails, inspect the output. The most likely failure modes:
- A typo in the value type (e.g., `centerStrength: "0.05"` would fail the number check)
- Negative or zero value (centerStrength must be > 0)

- [ ] **Step 4: Run TypeScript check**

Run: `npm run typecheck`
Expected: PASS. The new constants are referenced in Task 2, but adding them alone should not break any consumer (the `GRAPH` object's type is `as const`, so existing fields keep their inferred narrow types).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/config.ts
git commit -m "config: tune GRAPH force parameters

- subAgentLinkDistance: 100 → 320 (more main↔sub spacing)
- chargeDistanceMax: 500 (cap forceManyBody reach, bound drift)
- centerStrength: 0.05 (per-node center pull strength)

Spec: docs/superpowers/specs/2026-05-21-force-tuning-design.md"
```

---

## Task 2: Wire the new config into the force simulation

**Files:**
- Modify: `src/components/AgentGraph/useTopologyEffect.ts` (imports at lines 5 + 8, force builder at lines 236-244)

- [ ] **Step 1: Open and read the current `src/components/AgentGraph/useTopologyEffect.ts`**

Open the file. Note the current imports at the top — they should look approximately like:

```ts
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from "d3-force";
// ...
import { GRAPH } from "@/lib/config";
```

And the simulation builder lower in `useEffect`:

```ts
const simulation = forceSimulation<SimNode, SimLink>(nodes)
  .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => {
    if (d.edgeType === "tool") return GRAPH.toolLinkDistance;
    if (d.edgeType === "parent") return GRAPH.subAgentLinkDistance;
    return GRAPH.linkDistance;
  }))
  .force("charge", forceManyBody<SimNode>())
  .force("center", forceCenter(width / 2, height / 2))
  .force("collide", forceCollide<SimNode>().radius(GRAPH.nodeRadius + 4))
```

If your local file diverges from this shape (lines may have moved due to uncommitted edits), find the equivalent lines using the force names as anchors.

- [ ] **Step 2: Update the `d3-force` import (drop `forceCenter`, add `forceX` + `forceY`)**

Change:
```ts
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from "d3-force";
```

To:
```ts
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from "d3-force";
```

- [ ] **Step 3: Update the config import to also pull `getNodeRadius`**

Change:
```ts
import { GRAPH } from "@/lib/config";
```

To:
```ts
import { GRAPH, getNodeRadius } from "@/lib/config";
```

`getNodeRadius` is already exported from `src/lib/config.ts:49` (no changes needed there).

- [ ] **Step 4: Replace the charge, center, and collide force lines**

Change these three lines:
```ts
.force("charge", forceManyBody<SimNode>())
.force("center", forceCenter(width / 2, height / 2))
.force("collide", forceCollide<SimNode>().radius(GRAPH.nodeRadius + 4))
```

To these four lines:
```ts
.force("charge", forceManyBody<SimNode>().distanceMax(GRAPH.chargeDistanceMax))
.force("x", forceX<SimNode>(width / 2).strength(GRAPH.centerStrength))
.force("y", forceY<SimNode>(height / 2).strength(GRAPH.centerStrength))
.force("collide", forceCollide<SimNode>().radius((d) =>
  d.toolCall ? GRAPH.toolNodeRadius + 4 : getNodeRadius(d.agent) + 4,
))
```

Do **not** touch the `.force("link", ...)` call directly above — it already reads `GRAPH.subAgentLinkDistance` and will pick up the new 320px value from Task 1.

- [ ] **Step 5: Run TypeScript check**

Run: `npm run typecheck`
Expected: PASS.

Likely-cause errors and fixes:
- `Cannot find name 'forceCenter'` → another usage of `forceCenter` exists outside this file or this effect. Search with `grep -rn forceCenter src/` and convert remaining usages, OR keep `forceCenter` in the import if it's still used elsewhere.
- `Property 'toolCall' does not exist on type 'SimNode'` → the `SimNode` type in `@/lib/d3` doesn't have an optional `toolCall`. Verify with `grep -n 'toolCall' src/lib/d3/`. If missing, ask before adding — that's a type system change outside this plan's scope.
- `Argument of type ... is not assignable` on the collide radius callback → ensure the callback returns `number` (the `: 0` branch in earlier specs is gone; both branches now return a number).

- [ ] **Step 6: Run all existing tests**

Run: `npm test`
Expected: All pass. No tests directly exercise `useTopologyEffect`, so this run is regression coverage for surrounding modules.

- [ ] **Step 7: Manual verification per spec**

Start the dev server (`npm run dev`) and the WS server if needed, then:

1. Register one main agent with 6+ sub-agents, each with 1-2 tool calls.
   - Confirm sub-agents sit visibly further from the main than before (target ~320px center-to-center, ± charge tension).
   - Confirm tool rings around sub-agents do not visually crowd the main hex.
2. Register a second main with its own sub-agents.
   - Confirm the two mains settle at ~300px apart (link distance) regardless of how many sub-agents each has.
3. Spawn 10+ sub-agents and several tool calls under one main.
   - Confirm main↔main distance stays roughly constant as children appear — does not grow with child count. (Drift fix.)
4. Create an asymmetric tree (one main with 8 children, another with 1). Add and remove a sub-agent under the busy main.
   - Confirm the whole graph does not visibly slide across the canvas. (Centering-stability fix.)
5. Inspect tool node clustering visually.
   - Tool nodes should sit close to their parent sub-agent (tool-link distance ~80px + collide padding) and should not push the parent main or sibling sub-agents away. (Per-node collision fix.)

If any of these fail, do NOT commit. File a follow-up note in the spec and report back.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/components/AgentGraph/useTopologyEffect.ts
git commit -m "topology: tune d3-force per @d3/force-directed-tree pattern

- charge force gets distanceMax(500) — bounds main↔main drift
- replace forceCenter with weak forceX+forceY (centerStrength 0.05)
  for stable centering under add/remove churn
- per-node collide radius (tools 14+4, sub-agents 28+4, mains 42+4)
  via existing getNodeRadius helper + d.toolCall discriminator

Spec: docs/superpowers/specs/2026-05-21-force-tuning-design.md"
```

---

## Self-Review (already performed by plan author)

**Spec coverage:**

| Spec section | Implementing task |
|---|---|
| Fix 1: `.distanceMax()` on charge | Task 2 Step 4 |
| Fix 2: Widen `subAgentLinkDistance` | Task 1 Step 2 |
| Fix 3: Per-node collision radius | Task 2 Step 3 (import) + Step 4 (call) |
| Fix 4: `forceCenter` → `forceX`/`forceY` | Task 2 Step 2 (import) + Step 4 (call) |
| Config additions (`chargeDistanceMax`, `centerStrength`) | Task 1 Step 2 |
| Verification scenarios | Task 2 Step 7 |

**Placeholder scan:** No TBDs, no "implement later," no "add error handling" — all code shown in full.

**Type consistency:** `getNodeRadius` signature matches `(agent: { parentId?, teamId? })`; `SimNode.agent` is `AgentState` which has those fields. `d.toolCall` discriminator matches the optional field set in `useToolNodesEffect.ts:54`.
