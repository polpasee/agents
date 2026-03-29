# Claude Agent Monitor — Design Spec

A real-time monitoring dashboard that visualizes Claude agents and sub-agents as a live network graph with a cyber/neon aesthetic.

## Problem

When running complex Claude Code sessions or Agent SDK applications that spawn multiple sub-agents, there's no way to visualize agent hierarchy, status, communication, and resource usage in real time. This makes it hard to understand what agents are doing, debug failures, and optimize workflows.

## Solution

A Next.js web dashboard that connects to running agents via WebSocket, rendering them as an interactive D3.js force-directed graph with real-time status updates, animated data flow, and detailed inspection panels.

## Architecture

### System Overview

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Claude Code     │ ──────────────────▶│                  │
│  CLI Agents      │                    │   Standalone     │
└─────────────────┘                    │   WebSocket      │
                                       │   Server         │
┌─────────────────┐     WebSocket      │   (port 4001)    │
│  Agent SDK       │ ──────────────────▶│                  │
│  Applications    │                    └────────┬─────────┘
└─────────────────┘                             │
                                                │ broadcast
                                                ▼
                                       ┌──────────────────┐
                                       │  React Frontend  │
                                       │  (D3.js force    │
                                       │   graph + Neon)  │
                                       └──────────────────┘
```

### Components

1. **WebSocket Server** — Standalone server on port 4001 (`scripts/ws-server.ts`)
   - Accepts connections from agents (reporters) and dashboards (viewers)
   - Maintains in-memory agent graph state
   - Broadcasts state changes to all connected viewers
   - Handles agent reconnection and cleanup (TTL-based expiry for stale agents)

2. **Agent Reporter Client** — Lightweight SDK/library
   - Agents import this to report their state
   - Sends structured events over WebSocket
   - Auto-reconnects on disconnect
   - Minimal overhead — should not slow down agent execution

3. **React Dashboard** — The main UI
   - D3.js force-directed graph canvas for the node graph
   - Custom neon-themed SVG node and link rendering
   - Sidebar panels for agent list, detail inspection, and team overview
   - Activity stream for real-time event log

## Dashboard Layout

```
┌──────────────────────────────────────────────────────────┐
│ ● AGENT MONITOR          AGENTS: 5  ACTIVE: 3  ERRORS: 0│
├────────┬─────────────────────────────┬──────┬────────────┤
│        │                             │      │            │
│ Agent  │                             │ Team │  Selected  │
│ List   │    D3.js Force-Directed     │ Panel│  Agent     │
│        │    Graph Canvas             │      │  Details   │
│ - Main │                             │ Team │            │
│ - Exp. │   [MAIN] ──▶ [EXPLORE]      │ Alpha│ Status: ●  │
│ - Plan │     │                        │  3/5 │ Task: ...  │
│ - Build│     ├──▶ [PLAN]             │      │ Tools: ... │
│ - Lead │     └──▶ [BUILD]            │ Team │ Tokens: .. │
│        │                             │ Beta │ Duration:  │
│        │                             │  2/3 │            │
├────────┴──────────────────────┬──────┴──────┴────────────┤
│ Activity Stream               │ Replay Bar               │
│ 14:23:01 Main spawned #1      │ ◀ ▶ ⏸  ──●──────── 100% │
│ 14:23:03 Explorer called Grep │                          │
└───────────────────────────────┴──────────────────────────┘
```

### Panels

- **Top Bar**: App title with status LED, global stats (total/active/completed/error agents), WebSocket connection indicator
- **Left Sidebar** (~200px): Scrollable agent list with color-coded status dots, click to select and center graph on agent
- **Center Canvas**: D3.js force-directed graph with pan/zoom, dot-grid background, neon-styled SVG nodes and animated links
- **Team Panel** (~120px): Displays team-lead agents and their team membership, team stats (active/total), team color grouping
- **Right Sidebar** (~250px): Detail panel for selected agent — status, current task, recent tool calls, token usage bar, duration timer, child agent count
- **Bottom Panel** (~120px): Timestamped activity stream, auto-scrolling, filterable by agent or event type; session replay bar for scrubbing through recorded sessions

## Node Design

Each agent is rendered as a circular node with:

- **Outer ring**: Color-coded by agent type, animated pulse when active
- **Inner label**: Agent type name (Main, Explore, Plan, Build, Review, etc.)
- **Status indicator**: Small dot — green (running), yellow (waiting), blue (idle), red (error), gray (completed)
- **Task badge**: Small label below node showing current task (truncated)
- **Token arc**: Thin arc around the node showing token usage as a percentage of context window

### Node Colors by Agent Type

| Agent Type | Color | Hex |
|------------|-------|-----|
| Main Agent | Cyan | `#00f5ff` |
| Explore | Magenta | `#ff00ff` |
| Plan | Green | `#00ff88` |
| Build / Code | Amber | `#ffaa00` |
| Review | Purple | `#a78bfa` |
| Test | Pink | `#f472b6` |
| Team Lead | Gold | `#ffd700` |
| Generic | Slate | `#94a3b8` |

## Edge Design

Edges connect parent agents to their children:

- **Line style**: Animated dashed gradient — parent color fading to child color
- **Glow**: Subtle box-shadow along the edge path
- **Data flow particles**: Small glowing dots that travel along the edge when messages are sent between agents
- **Thickness**: Proportional to message frequency (optional)

## WebSocket Protocol

### Agent → Server Events

```typescript
// Agent connects and registers
{ type: "agent:register", agentId: string, parentId?: string, agentType: string, task: string, metadata?: Record<string, unknown> }

// Status change
{ type: "agent:status", agentId: string, status: "running" | "waiting" | "idle" | "completed" | "error", message?: string }

// Tool call
{ type: "agent:tool_call", agentId: string, tool: string, args?: string, result?: string }

// Token usage update
{ type: "agent:tokens", agentId: string, inputTokens: number, outputTokens: number, contextWindow: number }

// Message between agents
{ type: "agent:message", fromId: string, toId: string, content: string }

// Agent completed
{ type: "agent:complete", agentId: string, summary?: string, duration: number }
```

### Server → Dashboard Events (ServerEvent)

```typescript
// Full state sync (on connect) — includes team data
{ type: "state:sync", agents: Agent[], edges: Edge[], teams: Team[] }

// Incremental updates (forwarded agent events with timestamp)
{ type: "state:update", event: AgentEvent, timestamp: number }

// Agent removed (expired/disconnected)
{ type: "state:remove", agentId: string }

// Log response (returns log entries for a requested agent)
{ type: "log:response", agentId: string, logs: LogEntry[] }

// Log error (agent log retrieval failed)
{ type: "log:error", agentId: string, error: string }
```

### Dashboard → Server Events (ClientEvent)

```typescript
// Request logs for an agent
{ type: "log:request", agentId: string, since?: number, limit?: number }
```

## Team Support

The dashboard supports **team-lead** agents that coordinate groups of sub-agents:

- **Team Lead agent type**: A special agent type (color: Gold `#ffd700`) that manages a team of child agents
- **TeamPanel component**: Displays all teams, their lead agents, member counts (active/total), and aggregate stats (tokens, duration)
- **Team stats**: Each team shows a summary of active vs. total members, combined token usage, and error counts
- **Graph grouping**: D3 force simulation applies attraction forces to cluster team members together visually

## Animation Details

### Node Animations
- **Spawn**: Node fades in with a scale-up + glow burst animation (300ms, CSS transitions + D3)
- **Active pulse**: Ring opacity oscillates between 0.6-1.0 with a 2s cycle (CSS animation)
- **Completion**: Ring color transitions to gray, final glow pulse, then dims
- **Error**: Ring turns red with a shake animation, persistent red glow

### Edge Animations
- **Data flow**: Small luminous circles (3px) travel along the edge path at ~100px/s (D3 transition)
- **Idle edges**: Slow dash animation (CSS stroke-dashoffset cycling)
- **Active transfer**: Increased particle density and speed during message exchange

### Global Effects
- **Dot grid background**: Subtle parallax on pan
- **New agent ripple**: Faint circular ripple emanates from parent node when spawning a child
- **Heatmap overlay**: Optional heatmap visualization showing agent activity density

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16 | Full-stack framework (frontend) |
| React | 19 | UI rendering |
| D3.js | 7 | Force-directed graph rendering, pan/zoom, layout, heatmap |
| Tailwind CSS | 4 | Layout, utility classes, custom neon theme |
| Zustand | 5 | Client-side state management for agent graph |
| ws | 8 | Standalone WebSocket server implementation (port 4001) |
| TypeScript | 6 | Type safety across client and server |
| Vitest | 4 | Unit and integration testing |

## File Structure

```
agents/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with neon theme
│   │   └── page.tsx                # Dashboard page
│   ├── components/
│   │   ├── Dashboard.tsx           # Main dashboard container
│   │   ├── TopBar.tsx              # Header with stats
│   │   ├── AgentList.tsx           # Left sidebar agent list
│   │   ├── AgentGraph.tsx          # D3.js force-directed graph canvas
│   │   ├── AgentDetail.tsx         # Right sidebar detail panel
│   │   ├── ActivityStream.tsx      # Bottom activity log
│   │   ├── GraphControls.tsx       # Zoom, reset, layout toggle controls
│   │   ├── MiniMap.tsx             # Miniature overview of the full graph
│   │   ├── Timeline.tsx            # Timeline scrubber for event history
│   │   ├── TeamPanel.tsx           # Team overview panel with stats
│   │   ├── ErrorBoundary.tsx       # React error boundary wrapper
│   │   ├── ReplayBar.tsx           # Session replay transport controls
│   │   ├── LogViewer.tsx           # Agent log viewer panel
│   │   ├── CostProjection.tsx      # Cost projection & alert display
│   │   └── HeatmapControls.tsx     # Heatmap overlay toggle & settings
│   ├── lib/
│   │   ├── types.ts                # Shared TypeScript types
│   │   ├── store.ts                # Zustand store for agent state
│   │   ├── colors.ts               # Agent type → color mapping
│   │   ├── config.ts               # App configuration constants
│   │   ├── validation.ts           # Event & data validation helpers
│   │   ├── utils.ts                # General utility functions
│   │   ├── costs.ts                # Token cost calculation
│   │   ├── costProjection.ts       # Cost projection & alerting logic
│   │   └── d3/
│   │       ├── index.ts            # D3 graph initialization & force setup
│   │       ├── renderNode.ts       # SVG node rendering (circles, arcs, labels)
│   │       ├── updateLinks.ts      # Edge/link rendering & particle animation
│   │       └── heatmap.ts          # Heatmap overlay rendering
│   ├── hooks/
│   │   ├── useAgentGraph.ts        # Hook connecting WS to D3 graph
│   │   ├── useWebSocket.ts         # WebSocket client hook
│   │   ├── useReplay.ts            # Session replay state & controls
│   │   ├── useKeyboardShortcuts.ts # Keyboard shortcut bindings
│   │   ├── useFilteredAgents.ts    # Agent list filtering & search
│   │   └── useSoundNotifications.ts # Audio alerts for errors/events
│   └── styles/
│       └── neon.css                # Custom neon glow utilities
├── scripts/
│   ├── ws-server.ts                # Standalone WebSocket server (port 4001)
│   ├── mock-agents.ts              # Mock agent simulator for testing
│   └── lib/                        # Shared server-side utilities
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-26-agent-monitor-design.md
```

## Session Replay

The dashboard supports recording and replaying agent sessions for post-mortem analysis and demos:

- **Recording**: All WebSocket events are timestamped and stored in an in-memory buffer on the server; optionally persisted to a JSON file via `scripts/ws-server.ts`
- **ReplayBar component** (`ReplayBar.tsx`): Transport controls (play, pause, step forward/back, speed selector) and a timeline scrubber showing event density
- **useReplay hook** (`useReplay.ts`): Manages replay state — current position, playback speed (0.5x–8x), play/pause, and seeking to arbitrary timestamps
- **Replay mode**: When active, the dashboard disconnects from live WebSocket updates and replays buffered events through the Zustand store, driving the D3 graph as if events were arriving in real time
- **Timeline component** (`Timeline.tsx`): Visual timeline showing event markers; click to jump to any point in the session

## Agent Log Viewer

A dedicated panel for inspecting detailed logs from individual agents:

- **LogViewer component** (`LogViewer.tsx`): Displays log entries for the currently selected agent, with syntax-highlighted tool call arguments and results
- **On-demand fetching**: Sends a `log:request` ClientEvent to the server, which responds with `log:response` containing the matching log entries (or `log:error` on failure)
- **Filtering**: Filter logs by level (info, warn, error), tool name, or free-text search
- **Auto-scroll**: New log entries scroll into view automatically; scroll lock when the user scrolls up to review history
- **Integration**: Accessible from the AgentDetail right sidebar — click "View Logs" on any selected agent

## Cost Projections & Alerts

Real-time token cost tracking and burn-rate projections:

- **CostProjection component** (`CostProjection.tsx`): Displays current session cost, projected total cost based on burn rate, and alert thresholds
- **Cost calculation** (`lib/costs.ts`): Maps model token counts to dollar costs using configurable pricing tables
- **Projection engine** (`lib/costProjection.ts`): Extrapolates total session cost from the current burn rate (tokens/minute) and estimated remaining work
- **Alerts**: Configurable cost thresholds trigger visual warnings (yellow) and critical alerts (red) in the TopBar and CostProjection panel
- **Per-agent breakdown**: Shows which agents are consuming the most tokens and contributing most to cost

## Performance Heatmap

An overlay visualization showing agent activity density across the graph:

- **HeatmapControls component** (`HeatmapControls.tsx`): Toggle the heatmap overlay on/off, select metric (token usage, message frequency, error rate), and adjust opacity
- **D3 heatmap renderer** (`lib/d3/heatmap.ts`): Renders a canvas-based heatmap layer beneath the node graph using D3 contour density estimation
- **Metrics**: Supports multiple heat metrics — token throughput, message volume, error concentration, and agent spawn density
- **Real-time updates**: The heatmap recalculates periodically (every 2s) as new events arrive, showing shifting hot spots of activity
- **Color scales**: Uses perceptual color scales (viridis, plasma) for accessibility; configurable via HeatmapControls

## Verification Plan

1. **Dev server**: Run `npm run dev`, open `http://localhost:3000`, verify the dashboard renders with the neon theme and empty graph
2. **Mock agents**: Create a test script (`scripts/mock-agents.ts`) that simulates agents connecting, spawning sub-agents, sending tool calls, and completing — verify the graph updates in real time
3. **Node interaction**: Click a node, verify the detail panel updates. Pan/zoom the graph.
4. **Edge animation**: Verify particles flow along edges when mock agents send messages
5. **Activity stream**: Verify events appear in chronological order with correct timestamps and colors
6. **Reconnection**: Kill and restart the mock agent script, verify the dashboard handles disconnection gracefully
7. **Multiple viewers**: Open the dashboard in two browser tabs, verify both receive the same updates
