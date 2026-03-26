# Dashboard Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 features to the agent monitoring dashboard: fit-to-view, keyboard shortcuts, completed agent fade, agent type filter toggles, cost estimation, sound notifications, particle flow on links, tool call sparkline, mini-map, agent timeline view, and session recording/replay.

**Architecture:** Features are independent and can be implemented in any order. UI features modify existing components (TopBar, AgentGraph, Dashboard) or add new ones (Timeline, MiniMap). Server features (recording) extend the WebSocket protocol. All state flows through the Zustand store.

**Tech Stack:** React 19, D3.js 7, Zustand 5, TypeScript, SVG animations, Web Audio API, Next.js 16

---

## File Structure

### New Files
- `src/components/GraphControls.tsx` — Fit-to-view button, zoom controls, filter toggles
- `src/components/MiniMap.tsx` — Overview mini-map for the graph
- `src/components/Timeline.tsx` — Agent timeline/swim lane view
- `src/components/CostDisplay.tsx` — Token cost estimation display
- `src/hooks/useKeyboardShortcuts.ts` — Keyboard shortcut handler
- `src/hooks/useSoundNotifications.ts` — Web Audio API sound effects
- `src/lib/costs.ts` — Token pricing and cost calculation

### Modified Files
- `src/components/AgentGraph.tsx` — Particle flow, sparkline, fade, mini-map data, fit-to-view API
- `src/components/Dashboard.tsx` — Add new components to layout, timeline toggle
- `src/components/TopBar.tsx` — Add cost display, view toggle
- `src/lib/store.ts` — Add filter state, recording state, view mode
- `src/lib/types.ts` — Add new types (CostRate, ViewMode, RecordingState)
- `src/lib/config.ts` — Add cost rates, sparkline config
- `src/styles/neon.css` — New animations for particles, sparkline

---

## Task 1: Fit-to-View Button

**Files:**
- Create: `src/components/GraphControls.tsx`
- Modify: `src/components/AgentGraph.tsx`
- Modify: `src/components/Dashboard.tsx`

- [ ] **Step 1: Expose zoom ref from AgentGraph**

In `src/components/AgentGraph.tsx`, expose a `fitToView` callback via a ref that the parent can call. Add after the existing refs (line ~192):

```typescript
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";

export interface AgentGraphHandle {
  fitToView: () => void;
}
```

Change the component to use `forwardRef`:

```typescript
export const AgentGraph = forwardRef<AgentGraphHandle>(function AgentGraph(_props, ref) {
  // ... existing code ...
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  useImperativeHandle(ref, () => ({
    fitToView: () => {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current || nodesRef.current.length === 0) return;
      const nodes = nodesRef.current;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x);
          maxY = Math.max(maxY, n.y);
        }
      }
      const padding = 80;
      minX -= padding; minY -= padding; maxX += padding; maxY += padding;
      const width = svg.clientWidth;
      const height = svg.clientHeight;
      const dx = maxX - minX;
      const dy = maxY - minY;
      const scale = Math.min(width / dx, height / dy, 2);
      const tx = width / 2 - (minX + maxX) / 2 * scale;
      const ty = height / 2 - (minY + maxY) / 2 * scale;
      const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
      d3.select(svg).transition().duration(500).call(zoomRef.current.transform, transform);
    },
  }));
```

In the structural effect (Effect 1), store the zoom behavior in `zoomRef`:

```typescript
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH.zoomExtent)
      .on("zoom", (event) => canvas.attr("transform", event.transform));
    zoomRef.current = zoom;
    d3svg.call(zoom);
```

- [ ] **Step 2: Create GraphControls component**

Create `src/components/GraphControls.tsx`:

```typescript
"use client";

import { UI } from "@/lib/colors";

export function GraphControls({ onFitToView }: { onFitToView: () => void }) {
  return (
    <div
      className="absolute top-2 right-2 flex gap-1 z-10"
      style={{ pointerEvents: "auto" }}
    >
      <button
        onClick={onFitToView}
        className="px-2 py-1 rounded text-xs font-mono"
        style={{
          background: "var(--color-panel)",
          border: `1px solid ${UI.primary}33`,
          color: UI.text.secondary,
        }}
        title="Fit to view (F)"
      >
        FIT
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Wire GraphControls into Dashboard**

In `src/components/Dashboard.tsx`, add the ref and controls:

```typescript
"use client";

import { useRef } from "react";
import { TopBar } from "./TopBar";
import { AgentList } from "./AgentList";
import { AgentGraph, AgentGraphHandle } from "./AgentGraph";
import { AgentDetail } from "./AgentDetail";
import { ActivityStream } from "./ActivityStream";
import { GraphControls } from "./GraphControls";
import { useWebSocket } from "@/hooks/useWebSocket";

export function Dashboard() {
  useWebSocket();
  const graphRef = useRef<AgentGraphHandle>(null);

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <AgentList />
        <div className="relative flex-1">
          <AgentGraph ref={graphRef} />
          <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
        </div>
        <AgentDetail />
      </div>
      <ActivityStream />
    </div>
  );
}
```

- [ ] **Step 4: Verify fit-to-view works**

Run `npm run dev`. Open dashboard. Zoom/pan away from agents. Click FIT button — should animate graph to show all agents centered.

- [ ] **Step 5: Commit**

```bash
git add src/components/GraphControls.tsx src/components/AgentGraph.tsx src/components/Dashboard.tsx
git commit -m "feat: add fit-to-view button with smooth zoom animation"
```

---

## Task 2: Keyboard Shortcuts

**Files:**
- Create: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Create keyboard shortcuts hook**

Create `src/hooks/useKeyboardShortcuts.ts`:

```typescript
"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import type { AgentGraphHandle } from "@/components/AgentGraph";

export function useKeyboardShortcuts(graphRef: React.RefObject<AgentGraphHandle | null>) {
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if focused in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      switch (e.key) {
        case "Escape":
          selectAgent(null);
          break;
        case "f":
        case "F":
          graphRef.current?.fitToView();
          break;
        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const agentIds = Array.from(agents.keys());
          if (agentIds.length === 0) break;
          const currentIdx = selectedAgentId ? agentIds.indexOf(selectedAgentId) : -1;
          const nextIdx = e.key === "ArrowDown"
            ? (currentIdx + 1) % agentIds.length
            : (currentIdx - 1 + agentIds.length) % agentIds.length;
          selectAgent(agentIds[nextIdx]);
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectAgent, selectedAgentId, agents, graphRef]);
}
```

- [ ] **Step 2: Wire into Dashboard**

In `src/components/Dashboard.tsx`, add the hook:

```typescript
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export function Dashboard() {
  useWebSocket();
  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify shortcuts work**

Run dev server. Press `F` — should fit-to-view. Arrow keys — should cycle through agents. `Escape` — should deselect.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts src/components/Dashboard.tsx
git commit -m "feat: add keyboard shortcuts (F=fit, arrows=navigate, Esc=deselect)"
```

---

## Task 3: Completed Agent Fade

**Files:**
- Modify: `src/components/AgentGraph.tsx`

- [ ] **Step 1: Add opacity logic to renderNodeVisuals**

In `src/components/AgentGraph.tsx`, in `renderNodeVisuals`, set group opacity based on status. Add at the very start of the function, after the variable declarations:

```typescript
  // Fade completed/error agents
  const isFinished = agent.status === "completed" || agent.status === "error";
  if (isFinished) {
    g.attr("opacity", 0.35);
  }
```

- [ ] **Step 2: Fade link visuals for completed agents**

In `updateLinkVisuals`, add opacity to links connected to completed agents:

```typescript
  linkLine
    // ... existing .attr() chains ...
    .attr("stroke-opacity", (d) => {
      const a = agents.get(getTargetId(d));
      const finished = a?.status === "completed" || a?.status === "error";
      return finished ? 0.2 : 0.6;
    });

  linkGlow
    // ... existing .attr() chains ...
    .attr("stroke-opacity", (d) => {
      const a = agents.get(getTargetId(d));
      const finished = a?.status === "completed" || a?.status === "error";
      return finished ? 0.03 : 0.1;
    });
```

- [ ] **Step 3: Verify fade effect**

Run with mock-agents. Once agents complete, they should visually fade to ~35% opacity. Active agents remain bright.

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentGraph.tsx
git commit -m "feat: fade completed/error agents to 35% opacity"
```

---

## Task 4: Agent Type Filter Toggles

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/components/GraphControls.tsx`
- Modify: `src/hooks/useFilteredAgents.ts`

- [ ] **Step 1: Add filter state to store**

In `src/lib/store.ts`, add to the interface and initial state:

```typescript
interface AgentStore {
  // ... existing fields ...
  hiddenAgentTypes: Set<string>;
  toggleAgentType: (type: string) => void;
}
```

In the store creation:

```typescript
  hiddenAgentTypes: new Set(),
  toggleAgentType: (type) => {
    const { hiddenAgentTypes } = get();
    const next = new Set(hiddenAgentTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    set({ hiddenAgentTypes: next });
  },
```

- [ ] **Step 2: Apply filter in useFilteredAgents**

In `src/hooks/useFilteredAgents.ts`:

```typescript
import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import type { AgentState } from "@/lib/types";

export function useFilteredAgents(): AgentState[] {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  return useMemo(() => {
    let list = Array.from(agents.values());
    if (selectedSessionId) {
      list = list.filter(
        (a) => a.sessionId === selectedSessionId || a.id === selectedSessionId
      );
    }
    if (hiddenAgentTypes.size > 0) {
      list = list.filter((a) => !hiddenAgentTypes.has(a.agentType));
    }
    return list;
  }, [agents, selectedSessionId, hiddenAgentTypes]);
}
```

- [ ] **Step 3: Add filter toggles to GraphControls**

Update `src/components/GraphControls.tsx`:

```typescript
"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import type { AgentType } from "@/lib/types";

const FILTER_TYPES: AgentType[] = ["main", "explore", "plan", "build", "review", "test", "generic"];

export function GraphControls({ onFitToView }: { onFitToView: () => void }) {
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);
  const toggleAgentType = useAgentStore((s) => s.toggleAgentType);

  return (
    <div
      className="absolute top-2 right-2 flex flex-col gap-1 z-10"
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex gap-1">
        <button
          onClick={onFitToView}
          className="px-2 py-1 rounded text-xs font-mono"
          style={{
            background: "var(--color-panel)",
            border: `1px solid ${UI.primary}33`,
            color: UI.text.secondary,
          }}
          title="Fit to view (F)"
        >
          FIT
        </button>
      </div>
      <div className="flex gap-0.5 flex-wrap" style={{ maxWidth: 200 }}>
        {FILTER_TYPES.map((type) => {
          const hidden = hiddenAgentTypes.has(type);
          const color = AGENT_COLORS[type];
          return (
            <button
              key={type}
              onClick={() => toggleAgentType(type)}
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: hidden ? "var(--color-panel)" : `${color}22`,
                border: `1px solid ${hidden ? "var(--color-border)" : color}`,
                color: hidden ? UI.text.empty : color,
                opacity: hidden ? 0.5 : 1,
              }}
              title={`Toggle ${AGENT_LABELS[type]} agents`}
            >
              {AGENT_LABELS[type].charAt(0)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify filters work**

Click a filter button — agents of that type should disappear from the graph. Click again to restore. Verify links also update.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts src/hooks/useFilteredAgents.ts src/components/GraphControls.tsx
git commit -m "feat: add agent type filter toggles in graph controls"
```

---

## Task 5: Cost Estimation

**Files:**
- Create: `src/lib/costs.ts`
- Create: `src/components/CostDisplay.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Create cost calculation module**

Create `src/lib/costs.ts`:

```typescript
import type { AgentState } from "./types";

// Claude pricing per million tokens (USD)
const RATES = {
  input: 15,       // $15/M input tokens
  output: 75,      // $75/M output tokens
  cacheRead: 1.5,  // $1.5/M cache read tokens
  cacheWrite: 18.75, // $18.75/M cache write tokens
};

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function calculateCost(agent: AgentState): CostBreakdown {
  const input = (agent.inputTokens / 1_000_000) * RATES.input;
  const output = (agent.outputTokens / 1_000_000) * RATES.output;
  const cacheRead = (agent.cacheReadTokens / 1_000_000) * RATES.cacheRead;
  const cacheWrite = (agent.cacheCreateTokens / 1_000_000) * RATES.cacheWrite;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(2)}`;
}

export function calculateTotalCost(agents: Map<string, AgentState>): CostBreakdown {
  const totals: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const agent of agents.values()) {
    const c = calculateCost(agent);
    totals.input += c.input;
    totals.output += c.output;
    totals.cacheRead += c.cacheRead;
    totals.cacheWrite += c.cacheWrite;
    totals.total += c.total;
  }
  return totals;
}
```

- [ ] **Step 2: Add cost to TopBar**

In `src/components/TopBar.tsx`, add cost display next to the stats:

```typescript
import { calculateTotalCost, formatCost } from "@/lib/costs";
```

Inside the component, after the stats calculation:

```typescript
  const totalCost = calculateTotalCost(agents);
```

In the JSX, add after the ERRORS stat:

```tsx
        <Stat label="COST" value={formatCost(totalCost.total)} color={UI.primary} />
```

Update the `Stat` component to accept `string | number`:

```typescript
function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
```

- [ ] **Step 3: Add per-agent cost in AgentDetail**

In `src/components/AgentDetail.tsx`, add:

```typescript
import { calculateCost, formatCost } from "@/lib/costs";
```

After the duration section, add:

```tsx
        {/* Cost */}
        <DetailRow label="EST. COST">
          <span className="text-sm" style={{ color: UI.primary }}>
            {formatCost(calculateCost(agent).total)}
          </span>
        </DetailRow>
```

- [ ] **Step 4: Verify cost displays**

Run dev server. Cost should appear in TopBar and AgentDetail when agents have token usage.

- [ ] **Step 5: Commit**

```bash
git add src/lib/costs.ts src/components/TopBar.tsx src/components/AgentDetail.tsx
git commit -m "feat: add token cost estimation to TopBar and AgentDetail"
```

---

## Task 6: Sound Notifications

**Files:**
- Create: `src/hooks/useSoundNotifications.ts`
- Modify: `src/components/Dashboard.tsx`

- [ ] **Step 1: Create sound notifications hook**

Create `src/hooks/useSoundNotifications.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";

function playTone(frequency: number, duration: number, volume = 0.1) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = "sine";
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* AudioContext not available */ }
}

export function useSoundNotifications() {
  const activity = useAgentStore((s) => s.activity);
  const prevLenRef = useRef(activity.length);

  useEffect(() => {
    if (activity.length <= prevLenRef.current) {
      prevLenRef.current = activity.length;
      return;
    }

    // Check only new entries
    const newEntries = activity.slice(prevLenRef.current);
    prevLenRef.current = activity.length;

    for (const entry of newEntries) {
      switch (entry.event.type) {
        case "agent:complete":
          playTone(880, 0.3, 0.08);  // High A, short — completion chime
          break;
        case "agent:register":
          playTone(523, 0.15, 0.05); // C5, very short — spawn blip
          break;
      }
    }
  }, [activity]);
}
```

- [ ] **Step 2: Wire into Dashboard**

In `src/components/Dashboard.tsx`, add:

```typescript
import { useSoundNotifications } from "@/hooks/useSoundNotifications";

export function Dashboard() {
  useWebSocket();
  useSoundNotifications();
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify sounds**

Run mock-agents alongside the dashboard. Should hear a blip on agent spawn and a chime on completion.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSoundNotifications.ts src/components/Dashboard.tsx
git commit -m "feat: add subtle sound notifications for agent spawn and completion"
```

---

## Task 7: Particle Flow on Links

**Files:**
- Modify: `src/components/AgentGraph.tsx`
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Add particle config**

In `src/lib/config.ts`, add to the GRAPH object:

```typescript
  particleRadius: 3,
  particleSpeed: 1500, // ms for one traversal
```

- [ ] **Step 2: Add particle rendering in the structural effect**

In `src/components/AgentGraph.tsx`, inside Effect 1 (structural rebuild), after the link groups and before the node groups, add a particle group:

```typescript
    // Particle group for link flow animation
    const particleGroup = canvas.append("g").attr("class", "particles");
```

- [ ] **Step 3: Add particle animation in the visual update effect**

In Effect 2 (visual update), after link visual updates, add particle management:

```typescript
    // Animate particles on active links
    const particleGroup = d3svg.select<SVGGElement>("g.particles");
    if (!particleGroup.empty()) {
      particleGroup.selectAll("*").remove();
      const linkGroup = d3svg.select<SVGGElement>("g.links");
      linkGroup.selectAll<SVGLineElement, SimLink>("line.main").each(function (d) {
        const targetId = typeof d.target === "string" ? d.target : d.target.id;
        const a = agents.get(targetId);
        if (!a || (a.status !== "running" && a.status !== "idle")) return;

        const color = AGENT_COLORS[a.agentType];
        const source = d.source as SimNode;
        const target = d.target as SimNode;
        if (source.x == null || source.y == null || target.x == null || target.y == null) return;

        // Create 2 particles per active link, offset in time
        for (let i = 0; i < 2; i++) {
          const particle = particleGroup.append("circle")
            .attr("r", GRAPH.particleRadius)
            .attr("fill", color)
            .attr("opacity", 0);

          particle.append("animate")
            .attr("attributeName", "cx")
            .attr("values", `${source.x};${target.x}`)
            .attr("dur", `${GRAPH.particleSpeed}ms`)
            .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
            .attr("repeatCount", "indefinite");
          particle.append("animate")
            .attr("attributeName", "cy")
            .attr("values", `${source.y};${target.y}`)
            .attr("dur", `${GRAPH.particleSpeed}ms`)
            .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
            .attr("repeatCount", "indefinite");
          particle.append("animate")
            .attr("attributeName", "opacity")
            .attr("values", "0;0.8;0.8;0")
            .attr("dur", `${GRAPH.particleSpeed}ms`)
            .attr("begin", `${i * GRAPH.particleSpeed / 2}ms`)
            .attr("repeatCount", "indefinite");
        }
      });
    }
```

- [ ] **Step 4: Verify particle flow**

Run with active agents. Should see small dots flowing from parent to child on active links.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentGraph.tsx src/lib/config.ts
git commit -m "feat: add particle flow animation on active links"
```

---

## Task 8: Tool Call Sparkline

**Files:**
- Modify: `src/components/AgentGraph.tsx`
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Add sparkline config**

In `src/lib/config.ts`, add to GRAPH:

```typescript
  sparklineWidth: 40,
  sparklineHeight: 8,
  sparklineY: 62,
  sparklineBuckets: 10,
  sparklineBucketMs: 6000, // 6s per bucket = 60s window
```

- [ ] **Step 2: Add sparkline to renderNodeVisuals**

In `src/components/AgentGraph.tsx`, in `renderNodeVisuals`, after the status dot + label section, add:

```typescript
  // Tool call sparkline (mini bar chart of recent activity)
  if (agent.toolCalls.length > 0) {
    const now = Date.now();
    const buckets = new Array(GRAPH.sparklineBuckets).fill(0);
    for (const tc of agent.toolCalls) {
      const age = now - tc.timestamp;
      const bucketIdx = GRAPH.sparklineBuckets - 1 - Math.floor(age / GRAPH.sparklineBucketMs);
      if (bucketIdx >= 0 && bucketIdx < GRAPH.sparklineBuckets) {
        buckets[bucketIdx]++;
      }
    }
    const maxVal = Math.max(...buckets, 1);
    const barW = GRAPH.sparklineWidth / GRAPH.sparklineBuckets;
    const sparkG = g.append("g")
      .attr("transform", `translate(${-GRAPH.sparklineWidth / 2}, ${GRAPH.sparklineY})`);
    for (let i = 0; i < GRAPH.sparklineBuckets; i++) {
      const h = (buckets[i] / maxVal) * GRAPH.sparklineHeight;
      sparkG.append("rect")
        .attr("x", i * barW)
        .attr("y", GRAPH.sparklineHeight - h)
        .attr("width", barW - 0.5)
        .attr("height", h)
        .attr("fill", color)
        .attr("opacity", 0.6);
    }
  }
```

- [ ] **Step 3: Verify sparkline renders**

Run with active agents making tool calls. Small bar chart should appear below each node's status.

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentGraph.tsx src/lib/config.ts
git commit -m "feat: add tool call sparkline to graph nodes"
```

---

## Task 9: Mini-Map

**Files:**
- Create: `src/components/MiniMap.tsx`
- Modify: `src/components/AgentGraph.tsx`
- Modify: `src/components/Dashboard.tsx`

- [ ] **Step 1: Extend AgentGraphHandle with node data**

In `src/components/AgentGraph.tsx`, extend the handle:

```typescript
export interface AgentGraphHandle {
  fitToView: () => void;
  getNodesAndViewport: () => {
    nodes: Array<{ x: number; y: number; color: string }>;
    viewport: { x: number; y: number; width: number; height: number; scale: number };
    svgSize: { width: number; height: number };
  } | null;
}
```

Add to `useImperativeHandle`:

```typescript
    getNodesAndViewport: () => {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return null;
      const transform = d3.zoomTransform(svg);
      const nodes = nodesRef.current
        .filter((n) => n.x !== undefined && n.y !== undefined)
        .map((n) => ({
          x: n.x!,
          y: n.y!,
          color: AGENT_COLORS[n.agent.agentType] || "#94a3b8",
        }));
      return {
        nodes,
        viewport: {
          x: -transform.x / transform.k,
          y: -transform.y / transform.k,
          width: svg.clientWidth / transform.k,
          height: svg.clientHeight / transform.k,
          scale: transform.k,
        },
        svgSize: { width: svg.clientWidth, height: svg.clientHeight },
      };
    },
```

- [ ] **Step 2: Create MiniMap component**

Create `src/components/MiniMap.tsx`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { UI } from "@/lib/colors";
import type { AgentGraphHandle } from "./AgentGraph";

export function MiniMap({ graphRef }: { graphRef: React.RefObject<AgentGraphHandle | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      const data = graphRef.current?.getNodesAndViewport();
      const w = canvas!.width;
      const h = canvas!.height;
      ctx.clearRect(0, 0, w, h);

      if (!data || data.nodes.length === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      // Compute bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of data.nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x);
        maxY = Math.max(maxY, n.y);
      }
      const pad = 60;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const scale = Math.min(w / rangeX, h / rangeY);

      // Draw nodes
      for (const n of data.nodes) {
        const x = (n.x - minX) * scale;
        const y = (n.y - minY) * scale;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      // Draw viewport rect
      const vp = data.viewport;
      const rx = (vp.x - minX) * scale;
      const ry = (vp.y - minY) * scale;
      const rw = vp.width * scale;
      const rh = vp.height * scale;
      ctx.strokeStyle = UI.primary;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1;

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [graphRef]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={100}
      className="absolute bottom-2 right-2 rounded"
      style={{
        background: `${UI.text.empty}33`,
        border: `1px solid var(--color-border)`,
      }}
    />
  );
}
```

- [ ] **Step 3: Add MiniMap to Dashboard**

In `src/components/Dashboard.tsx`, inside the graph container div:

```typescript
import { MiniMap } from "./MiniMap";

// In JSX, inside the relative div:
        <div className="relative flex-1">
          <AgentGraph ref={graphRef} />
          <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
          <MiniMap graphRef={graphRef} />
        </div>
```

- [ ] **Step 4: Verify mini-map**

Run dev server. Mini-map should appear bottom-right showing dots for agents and a viewport rectangle that moves with zoom/pan.

- [ ] **Step 5: Commit**

```bash
git add src/components/MiniMap.tsx src/components/AgentGraph.tsx src/components/Dashboard.tsx
git commit -m "feat: add mini-map overview for graph navigation"
```

---

## Task 10: Agent Timeline View

**Files:**
- Create: `src/components/Timeline.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add view mode to store**

In `src/lib/store.ts`, add:

```typescript
interface AgentStore {
  // ... existing ...
  viewMode: "graph" | "timeline";
  setViewMode: (mode: "graph" | "timeline") => void;
}

// In store:
  viewMode: "graph",
  setViewMode: (mode) => set({ viewMode: mode }),
```

- [ ] **Step 2: Create Timeline component**

Create `src/components/Timeline.tsx`:

```typescript
"use client";

import { useFilteredAgents } from "@/hooks/useFilteredAgents";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import { useAgentStore } from "@/lib/store";
import { formatDuration, truncateId } from "@/lib/utils";

export function Timeline() {
  const agents = useFilteredAgents();
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: UI.text.empty }}>
        No agents to display
      </div>
    );
  }

  const now = Date.now();
  const earliest = Math.min(...agents.map((a) => a.startTime));
  const totalRange = now - earliest || 1;

  // Sort: active first, then by start time
  const sorted = [...agents].sort((a, b) => {
    const aActive = a.status === "running" || a.status === "idle" ? 0 : 1;
    const bActive = b.status === "running" || b.status === "idle" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.startTime - b.startTime;
  });

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4" style={{ background: "var(--color-bg)" }}>
      {sorted.map((agent) => {
        const color = AGENT_COLORS[agent.agentType];
        const statusColor = STATUS_COLORS[agent.status];
        const startPct = ((agent.startTime - earliest) / totalRange) * 100;
        const endTime = agent.duration ? agent.startTime + agent.duration : now;
        const widthPct = Math.max(((endTime - agent.startTime) / totalRange) * 100, 1);
        const isSelected = agent.id === selectedAgentId;
        const elapsed = agent.duration || now - agent.startTime;

        return (
          <div
            key={agent.id}
            className="flex items-center gap-3 py-1 cursor-pointer"
            onClick={() => selectAgent(agent.id)}
            style={{ opacity: isSelected ? 1 : 0.8 }}
          >
            {/* Label */}
            <div className="flex-shrink-0" style={{ width: 120 }}>
              <span className="text-xs font-mono font-bold" style={{ color }}>
                {AGENT_LABELS[agent.agentType]}
              </span>
              <span className="text-xs ml-1" style={{ color: UI.text.dimmed }}>
                {truncateId(agent.id)}
              </span>
            </div>

            {/* Swim lane */}
            <div className="flex-1 relative" style={{ height: 20 }}>
              {/* Background track */}
              <div
                className="absolute inset-0 rounded-sm"
                style={{ background: "var(--color-border)" }}
              />
              {/* Active bar */}
              <div
                className="absolute top-0 bottom-0 rounded-sm"
                style={{
                  left: `${startPct}%`,
                  width: `${widthPct}%`,
                  background: `${color}44`,
                  border: `1px solid ${isSelected ? color : `${color}66`}`,
                  boxShadow: isSelected ? `0 0 6px ${color}66` : "none",
                }}
              >
                {/* Tool call ticks */}
                {agent.toolCalls.map((tc, i) => {
                  const tickPct = ((tc.timestamp - agent.startTime) / (endTime - agent.startTime)) * 100;
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${Math.min(tickPct, 100)}%`,
                        width: 1,
                        background: color,
                        opacity: 0.5,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Duration + Status */}
            <div className="flex-shrink-0 text-right" style={{ width: 80 }}>
              <div className="text-xs font-mono" style={{ color: UI.text.secondary }}>
                {formatDuration(elapsed)}
              </div>
              <div className="flex items-center justify-end gap-1">
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ background: statusColor }}
                />
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {agent.status}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Add view toggle to TopBar**

In `src/components/TopBar.tsx`, add:

```typescript
  const viewMode = useAgentStore((s) => s.viewMode);
  const setViewMode = useAgentStore((s) => s.setViewMode);
```

Add toggle buttons after the session dropdown, inside the left section:

```tsx
        <div className="flex gap-0.5 ml-2">
          {(["graph", "timeline"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="px-2 py-0.5 rounded text-xs font-mono capitalize"
              style={{
                background: viewMode === mode ? `${UI.primary}22` : "transparent",
                border: `1px solid ${viewMode === mode ? UI.primary : "var(--color-border)"}`,
                color: viewMode === mode ? UI.primary : UI.text.muted,
              }}
            >
              {mode}
            </button>
          ))}
        </div>
```

- [ ] **Step 4: Conditionally render Graph or Timeline in Dashboard**

In `src/components/Dashboard.tsx`:

```typescript
import { Timeline } from "./Timeline";
import { useAgentStore } from "@/lib/store";

export function Dashboard() {
  useWebSocket();
  useSoundNotifications();
  const graphRef = useRef<AgentGraphHandle>(null);
  useKeyboardShortcuts(graphRef);
  const viewMode = useAgentStore((s) => s.viewMode);

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg)" }}>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <AgentList />
        <div className="relative flex-1">
          {viewMode === "graph" ? (
            <>
              <AgentGraph ref={graphRef} />
              <GraphControls onFitToView={() => graphRef.current?.fitToView()} />
              <MiniMap graphRef={graphRef} />
            </>
          ) : (
            <Timeline />
          )}
        </div>
        <AgentDetail />
      </div>
      <ActivityStream />
    </div>
  );
}
```

- [ ] **Step 5: Verify timeline view**

Click "timeline" toggle in TopBar. Should see swim lane view with agent bars, tool call ticks, durations, and status.

- [ ] **Step 6: Commit**

```bash
git add src/components/Timeline.tsx src/lib/store.ts src/components/TopBar.tsx src/components/Dashboard.tsx
git commit -m "feat: add agent timeline swim lane view with view toggle"
```

---

## Task 11: Session Recording & Replay

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add recording state to store**

In `src/lib/types.ts`, add:

```typescript
export interface RecordedSession {
  startTime: number;
  events: Array<{ timestamp: number; event: AgentEvent }>;
}
```

In `src/lib/store.ts`, add:

```typescript
import type { RecordedSession } from "./types";

interface AgentStore {
  // ... existing ...
  recording: boolean;
  recordedEvents: Array<{ timestamp: number; event: AgentEvent }>;
  startRecording: () => void;
  stopRecording: () => RecordedSession;
  downloadRecording: () => void;
}
```

Add to store:

```typescript
  recording: false,
  recordedEvents: [],

  startRecording: () => set({ recording: true, recordedEvents: [] }),

  stopRecording: () => {
    const { recordedEvents } = get();
    const session: RecordedSession = {
      startTime: recordedEvents[0]?.timestamp || Date.now(),
      events: recordedEvents,
    };
    set({ recording: false });
    return session;
  },

  downloadRecording: () => {
    const { recordedEvents } = get();
    const session: RecordedSession = {
      startTime: recordedEvents[0]?.timestamp || Date.now(),
      events: recordedEvents,
    };
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-session-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    set({ recording: false, recordedEvents: [] });
  },
```

Also update `handleEvent` to record events when recording is active:

```typescript
  handleEvent: (event, timestamp) => {
    const { agents, edges, activity, recording, recordedEvents } = get();
    // ... existing event processing ...

    const updates: Partial<AgentStore> = {
      agents: newAgents,
      edges: newEdges,
      activity: newActivity,
    };

    if (recording) {
      updates.recordedEvents = [...recordedEvents, { timestamp, event }];
    }

    set(updates);
  },
```

- [ ] **Step 2: Add record button to TopBar**

In `src/components/TopBar.tsx`, add:

```typescript
  const recording = useAgentStore((s) => s.recording);
  const startRecording = useAgentStore((s) => s.startRecording);
  const downloadRecording = useAgentStore((s) => s.downloadRecording);
```

Add record button after the view toggle:

```tsx
        <button
          onClick={recording ? downloadRecording : startRecording}
          className="px-2 py-0.5 rounded text-xs font-mono ml-2"
          style={{
            background: recording ? `${UI.error}22` : "transparent",
            border: `1px solid ${recording ? UI.error : "var(--color-border)"}`,
            color: recording ? UI.error : UI.text.muted,
          }}
          title={recording ? "Stop & download recording" : "Start recording"}
        >
          {recording ? "REC" : "REC"}
        </button>
```

- [ ] **Step 3: Verify recording**

Start recording, let agents run, click stop. A JSON file should download containing all events.

- [ ] **Step 4: Commit**

```bash
git add src/lib/store.ts src/lib/types.ts src/components/TopBar.tsx
git commit -m "feat: add session recording with JSON export"
```

---

## Verification

After all tasks are complete:

1. Run `npx tsc --noEmit` — should pass with zero errors
2. Run `npx next build` — should build successfully
3. Run `npm run dev` alongside `npm run ws-server` — visual verification:
   - FIT button centers all agents
   - Arrow keys navigate, F fits, Esc deselects
   - Completed agents are faded
   - Type filter buttons show/hide agents
   - Cost shows in TopBar and AgentDetail
   - Subtle sounds on spawn/completion
   - Particles flow on active links
   - Sparklines show under active nodes
   - Mini-map shows overview bottom-right
   - Timeline view toggles from TopBar
   - REC button records and exports JSON
