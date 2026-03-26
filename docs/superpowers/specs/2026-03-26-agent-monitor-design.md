# Claude Agent Monitor — Design Spec

A real-time monitoring dashboard that visualizes Claude agents and sub-agents as a live network graph with a cyber/neon aesthetic.

## Problem

When running complex Claude Code sessions or Agent SDK applications that spawn multiple sub-agents, there's no way to visualize agent hierarchy, status, communication, and resource usage in real time. This makes it hard to understand what agents are doing, debug failures, and optimize workflows.

## Solution

A Next.js web dashboard that connects to running agents via WebSocket, rendering them as an interactive node graph with real-time status updates, animated data flow, and detailed inspection panels.

## Architecture

### System Overview

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Claude Code     │ ──────────────────▶│                  │
│  CLI Agents      │                    │   WebSocket      │
└─────────────────┘                    │   Server         │
                                       │   (Next.js API)  │
┌─────────────────┐     WebSocket      │                  │
│  Agent SDK       │ ──────────────────▶│                  │
│  Applications    │                    └────────┬─────────┘
└─────────────────┘                             │
                                                │ broadcast
                                                ▼
                                       ┌──────────────────┐
                                       │  React Frontend  │
                                       │  (React Flow +   │
                                       │   Neon Theme)    │
                                       └──────────────────┘
```

### Components

1. **WebSocket Server** — Next.js API route (`/api/ws`) or standalone server
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
   - React Flow canvas for the node graph
   - Custom neon-themed node and edge components
   - Sidebar panels for agent list and detail inspection
   - Activity stream for real-time event log

## Dashboard Layout

```
┌──────────────────────────────────────────────────────────┐
│ ● AGENT MONITOR          AGENTS: 5  ACTIVE: 3  ERRORS: 0│
├──────────┬───────────────────────────────┬───────────────┤
│          │                               │               │
│  Agent   │                               │   Selected    │
│  List    │      Node Graph Canvas        │   Agent       │
│          │      (React Flow)             │   Details     │
│  - Main  │                               │               │
│  - Exp.  │    [MAIN] ──▶ [EXPLORE]       │  Status: ●    │
│  - Plan  │      │                        │  Task: ...    │
│  - Build │      ├──▶ [PLAN]              │  Tools: ...   │
│          │      └──▶ [BUILD]             │  Tokens: ...  │
│          │                               │  Duration: .. │
├──────────┴───────────────────────────────┴───────────────┤
│ Activity Stream                                          │
│ 14:23:01 Main spawned Explorer #1 — "Search for auth"    │
│ 14:23:03 Explorer #1 called Grep — "authenticate"        │
└──────────────────────────────────────────────────────────┘
```

### Panels

- **Top Bar**: App title with status LED, global stats (total/active/completed/error agents), WebSocket connection indicator
- **Left Sidebar** (~200px): Scrollable agent list with color-coded status dots, click to select and center graph on agent
- **Center Canvas**: React Flow graph with pan/zoom, dot-grid background, neon-styled nodes and animated edges
- **Right Sidebar** (~250px): Detail panel for selected agent — status, current task, recent tool calls, token usage bar, duration timer, child agent count
- **Bottom Panel** (~120px): Timestamped activity stream, auto-scrolling, filterable by agent or event type

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

### Server → Dashboard Events

```typescript
// Full state sync (on connect)
{ type: "state:sync", agents: Agent[], edges: Edge[] }

// Incremental updates (forwarded agent events with timestamp)
{ type: "state:update", event: AgentEvent, timestamp: number }

// Agent removed (expired/disconnected)
{ type: "state:remove", agentId: string }
```

## Animation Details

### Node Animations
- **Spawn**: Node fades in with a scale-up + glow burst animation (300ms)
- **Active pulse**: Ring opacity oscillates between 0.6–1.0 with a 2s cycle
- **Completion**: Ring color transitions to gray, final glow pulse, then dims
- **Error**: Ring turns red with a shake animation, persistent red glow

### Edge Animations
- **Data flow**: Small luminous circles (3px) travel along the edge path at ~100px/s
- **Idle edges**: Slow dash animation (CSS stroke-dashoffset cycling)
- **Active transfer**: Increased particle density and speed during message exchange

### Global Effects
- **Dot grid background**: Subtle parallax on pan
- **New agent ripple**: Faint circular ripple emanates from parent node when spawning a child

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Next.js 15 | Full-stack framework (frontend + API routes) |
| TypeScript | Type safety across client and server |
| React Flow | Node graph rendering, pan/zoom, layout |
| Tailwind CSS | Layout, utility classes, custom neon theme |
| Framer Motion | Panel transitions, node spawn/despawn animations |
| ws | WebSocket server implementation |
| Zustand | Client-side state management for agent graph |

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
│   │   ├── page.tsx                # Dashboard page
│   │   └── api/
│   │       └── ws/
│   │           └── route.ts        # WebSocket upgrade endpoint
│   ├── components/
│   │   ├── Dashboard.tsx           # Main dashboard container
│   │   ├── TopBar.tsx              # Header with stats
│   │   ├── AgentList.tsx           # Left sidebar agent list
│   │   ├── AgentGraph.tsx          # React Flow canvas wrapper
│   │   ├── AgentDetail.tsx         # Right sidebar detail panel
│   │   ├── ActivityStream.tsx      # Bottom activity log
│   │   ├── nodes/
│   │   │   └── AgentNode.tsx       # Custom React Flow node component
│   │   └── edges/
│   │       └── NeonEdge.tsx        # Custom React Flow edge with particles
│   ├── lib/
│   │   ├── types.ts                # Shared TypeScript types
│   │   ├── ws-server.ts            # WebSocket server logic
│   │   ├── store.ts                # Zustand store for agent state
│   │   └── colors.ts               # Agent type → color mapping
│   ├── hooks/
│   │   ├── useAgentGraph.ts        # Hook connecting WS to React Flow
│   │   └── useWebSocket.ts         # WebSocket client hook
│   └── styles/
│       └── neon.css                # Custom neon glow utilities
├── reporter/
│   ├── package.json                # Publishable reporter client
│   ├── index.ts                    # Agent reporter SDK entry
│   └── types.ts                    # Shared event types
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-26-agent-monitor-design.md
```

## Verification Plan

1. **Dev server**: Run `npm run dev`, open `http://localhost:3000`, verify the dashboard renders with the neon theme and empty graph
2. **Mock agents**: Create a test script (`scripts/mock-agents.ts`) that simulates agents connecting, spawning sub-agents, sending tool calls, and completing — verify the graph updates in real time
3. **Node interaction**: Click a node, verify the detail panel updates. Pan/zoom the graph.
4. **Edge animation**: Verify particles flow along edges when mock agents send messages
5. **Activity stream**: Verify events appear in chronological order with correct timestamps and colors
6. **Reconnection**: Kill and restart the mock agent script, verify the dashboard handles disconnection gracefully
7. **Multiple viewers**: Open the dashboard in two browser tabs, verify both receive the same updates
