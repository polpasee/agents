# Agent Flow Visual Redesign Spec

**Goal:** Transform the dashboard graph visualization to match Agent Flow's sci-fi hexagonal aesthetic.

## 1. Hexagonal Nodes

Replace circle nodes with hexagon `<polygon>` paths in `renderNodeVisuals`:
- Hexagon radius: 24px (flat-top orientation)
- Fill: `var(--color-bg)` (solid dark, not transparent)
- Stroke: agent type color, 2px width
- Center: agent type letter (monospace, 16px bold)
- Above hex: cost label (`$0.23`) in small cyan text
- Below hex: agent label + status dot/text (same as current)
- Active nodes: pulsing glow ring as hexagon outline (not circle)

Hex point calculation:
```
for i in 0..5: (cx + r * cos(60*i), cy + r * sin(60*i))
```
Flat-top: offset by 0 degrees (point at right).

## 2. Tool Call Satellite Nodes

Show the most recent tool call as a small pill node branching off each agent:
- Pill shape: rounded rect, ~120x22px
- Text: tool name + truncated args (e.g., "Read: src/lib/store.ts")
- Connected to parent agent by a short curved line (~60px)
- Color: dimmed version of agent color
- Only shown for running/idle agents with recent tool calls
- Position: offset to the right of the agent node

## 3. Curved Bezier Links

Replace `<line>` elements with `<path>` using cubic bezier curves:
- Curve calculation: midpoint offset perpendicular to the line by 30% of distance
- Glow path (background): 6px stroke, 0.1 opacity
- Main path: 2px stroke, 0.6 opacity
- Active links: dashed with animated dash-offset
- Particles follow the bezier path using `<animateMotion>` with the same path

## 4. Darker Theme

Update CSS variables in `globals.css`:
- `--color-bg`: `#060a14` (deeper navy)
- `--color-panel`: `#0a0f1a` (darker panels)
- `--color-border`: `#141e30` (slightly more visible borders)

## 5. Bottom Timeline Bar

Replace the text-based `ActivityStream` with a visual `TimelineBar`:
- Height: 48px (compact, down from 160px)
- Left: "LIVE" indicator with pulsing green dot + elapsed time
- Center: horizontal track with colored dots for events
  - Cyan dot: agent register
  - Green dot: tool call
  - Gray dot: agent complete
  - Red dot: error
- Right: total agent count + cost
- Events positioned proportionally along the time axis
- Auto-scrolls to show most recent events

## 6. Files to Modify

- `src/components/AgentGraph.tsx` — Hexagons, bezier links, tool satellites
- `src/components/TimelineBar.tsx` — New component replacing ActivityStream
- `src/components/Dashboard.tsx` — Swap ActivityStream for TimelineBar
- `src/app/globals.css` — Darker color variables
- `src/lib/config.ts` — Hex geometry constants
- `src/styles/neon.css` — Enhanced glow effects

## 7. What Stays Unchanged

- TopBar, AgentList, AgentDetail, GraphControls, MiniMap
- Store, types, hooks, WebSocket, costs, utils
- Timeline swim lane view, keyboard shortcuts, filters, recording
- All server-side code
