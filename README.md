# Claude Agent Monitor

**Real-time monitoring dashboard for Claude Code sub-agents and Agent SDK applications.**

Built with Next.js 16, React 19, TypeScript, D3.js, Zustand, and WebSocket. Features a cyber/neon aesthetic with force-directed graph visualization.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js) ![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript) ![D3.js](https://img.shields.io/badge/D3.js-7-F9A03C?style=flat-square&logo=d3.js) ![Zustand](https://img.shields.io/badge/Zustand-5-433E38?style=flat-square) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss) ![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?style=flat-square&logo=vitest)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the WebSocket server
npm run ws-server

# 3. Start the dev server
npm run dev

# 4. Open the dashboard
open http://localhost:4000

# 5. (Optional) Run mock agents for development
npm run mock-agents
```

## Security & Trust Model

> **Warning:** This dashboard is localhost-only and transmits raw Claude Code transcripts including conversation history, tool inputs/outputs, and file contents **without redaction**. Do not expose ports 4000/4001 to untrusted networks. Transcripts may contain credentials, API keys, or sensitive file contents. See [SECURITY.md](SECURITY.md) for details.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Claude Code     │ ──────────────────>│                  │
│  CLI Agents      │                    │   WebSocket      │
└─────────────────┘                    │   Server         │
                                       │   (standalone    │
┌─────────────────┐     WebSocket      │    port 4001)    │
│  Agent SDK       │ ──────────────────>│                  │
│  Applications    │                    └────────┬─────────┘
└─────────────────┘                             │
                                                │ broadcast
                                                v
                                       ┌──────────────────┐
                                       │  React Frontend  │
                                       │  (D3.js Graph +  │
                                       │   Neon Theme)    │
                                       └──────────────────┘
```

Agents and SDK applications connect to a standalone WebSocket server on port 4001. The server broadcasts events to the React frontend, which renders a real-time force-directed graph and supporting panels.

## Features

### Core

- **Real-Time Agent Graph** — D3.js force-directed graph with animated nodes color-coded by agent type, pulsing active rings, data flow particles along edges, and hover tooltips.
- **Agent List Sidebar** — Left panel with a scrollable, filterable agent list and color-coded status dots. Click to select.
- **Agent Detail Panel** — Right panel displaying status, model, slug, team, task, token usage (with cache read/write), duration, estimated cost, recent tool calls, and summary.
- **Activity Stream** — Bottom panel with a timestamped event log and auto-scrolling.
- **Top Bar** — Global stats (total/active/completed/error agents, total cost), WebSocket connection status indicator, and session recording controls.
- **Timeline View** — Alternative view mode; toggle between graph and timeline.
- **Mini Map** — Overview navigation widget for the graph canvas.
- **Graph Controls** — Fit-to-view button, agent type filters to toggle visibility per type.
- **Team Support** — Team panel showing team groupings, members, and stats. Includes a team-lead agent type.
- **Keyboard Shortcuts** — Escape (deselect), F (fit to view), Arrow Up/Down (navigate agents).
- **Sound Notifications** — Audio alerts for agent events.
- **Error Boundaries** — React error boundaries around every major component for graceful failure handling.

### Advanced (Foundation)

- **Session Replay** — Load recorded JSON session files and replay with transport controls (play/pause/seek), speed control (0.5x / 1x / 2x / 4x), and a progress slider. Use the LOAD button in the top bar.
- **Agent Log Viewer** — Modal viewer for full conversation logs (user/assistant/system messages) with collapsible tool calls showing args and results, plus search functionality. Triggered via the LOG button in the agent detail panel. Uses client-to-server WebSocket messaging.
- **Cost Projections & Alerts** — Real-time burn rate ($/min), projected total cost, and a configurable budget threshold persisted in localStorage. Visual warnings pulse amber at 80% and red at 95% of budget.
- **Performance Heatmap** — Graph overlay mode coloring nodes by performance metric (green = healthy, red = bottleneck). Metrics include idle ratio, token efficiency, time to first tool, and average tool latency. Toggle via the HEAT button.

### Monitoring & Observability (F1–F4)

- **F1: Blocking Edge Visualizations** — Red dashed edges with animated stroke and pulsing opacity to indicate blocked dependencies in the agent graph. Includes arrowhead markers and a topology key legend.
- **F2: Error Drill-Down** — Modal showing error message, cascade chain (agents affected by an error), and last tool calls for errored agents. Triggered via VIEW ERROR button in agent detail panel.
- **F3: Agent Efficiency Scoring** — Per-agent 0-100 efficiency score combining token efficiency, tool success rate, and completion speed. Displayed in agent detail with a color-coded progress ring.
- **F4: Live Metrics Dashboard** — Collapsible panel with 4 D3 sparkline area charts showing active agent count, tokens/sec, cost/min, and total cost over time. Toggle via METRICS button in top bar.

### Collaboration (F5–F7)

- **F5: Multi-Session Support** — Session selector in top bar for filtering agents by session. Supports all-session or per-session views.
- **F6: Annotation Overlay** — Per-agent text annotations synced via WebSocket. Add/remove annotations in the agent detail panel with real-time broadcast to all connected viewers.
- **F7: Team Workflow Visualization** — Animated inter-agent message edges with directional particles showing team communication flow in the graph.

### Developer Experience (F8–F10)

- **F8: Diff Viewer** — Modal showing file modifications per agent (created/edited/deleted files) with operation badges. Triggered via DIFFS button in agent detail.
- **F9: Context Window Gauge** — Visual progress bar in agent detail showing context window utilization with color-coded thresholds (green/amber/red).
- **F10: Session Export** — Export current session data as JSON, CSV, or Markdown reports. Includes agent counts, token totals, cost summaries, and per-agent details. Toggle via EXPORT button.

### Performance & UX (F11–F13)

- **F11: Smooth Layout Transitions** — Animated node position transitions when switching graph layouts or applying filters, using D3 transitions with easing.
- **F12: Graph Layout Modes** — Four layout options: Force (default physics simulation), Tree (top-down hierarchy), Radial (polar projection), and Hierarchical (left-to-right). Pill buttons in graph controls.
- **F13: Responsive Design** — Mobile-first responsive layout with slide-over sidebars (<768px), reduced sidebar widths for tablet (768-1024px), and full layout for desktop. Mobile toggle buttons and backdrop.

### Advanced Analytics (F14–F15)

- **F14: Session Comparison** — Side-by-side comparison of two sessions with metrics grid (agents, tokens, cost, duration), delta coloring (green=better, red=worse), and per-session agent cards. Toggle via COMPARE button.
- **F15: Agent Efficiency Score** — Composite performance scoring with breakdown by token efficiency, tool success rate, and completion speed.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server on port 4000 |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run ws-server` | Start WebSocket server (port 4001) |
| `npm run mock-agents` | Run mock agent simulator |
| `npm run test` | Run tests with Vitest |
| `npm run test:watch` | Watch mode for tests |
| `npm run type-check` | TypeScript type check |

## WebSocket Protocol

### Agent to Server Events

| Event | Description |
|-------|-------------|
| `agent:register` | Agent connects with id, parentId, agentType, task, sessionId, slug, model, teamId, metadata |
| `agent:status` | Status change (running / waiting / idle / completed / error) |
| `agent:tool_call` | Tool call with tool name, args, result |
| `agent:tokens` | Token usage update (input, output, cacheRead, cacheCreate, contextWindow) |
| `agent:message` | Inter-agent message (fromId, toId, content) |
| `agent:complete` | Agent finished (summary, duration) |

### Server to Dashboard Events

| Event | Description |
|-------|-------------|
| `state:sync` | Full state sync on connect (agents, edges, teams) |
| `state:update` | Incremental event update with timestamp |
| `state:remove` | Agent removed |
| `log:response` | Conversation log entries for an agent |
| `log:error` | Log fetch error |

### Dashboard to Server Events

| Event | Description |
|-------|-------------|
| `log:request` | Request conversation log for an agent |

## Agent Types & Colors

| Type | Color | Hex |
|------|-------|-----|
| Main | Cyan | `#00f5ff` |
| Explore | Magenta | `#ff00ff` |
| Plan | Green | `#00ff88` |
| Build | Amber | `#ffaa00` |
| Review | Purple | `#a78bfa` |
| Test | Pink | `#f472b6` |
| Team Lead | Gold | `#ffd700` |
| Generic | Slate | `#94a3b8` |

## Agent Statuses

| Status | Color | Hex |
|--------|-------|-----|
| Running | Green | `#00ff88` |
| Waiting | Yellow | `#eab308` |
| Idle | Blue | `#3b82f6` |
| Completed | Gray | `#6b7280` |
| Error | Red | `#ff4444` |

## Cost Model

Per-million-token pricing by model:

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Opus | $15.00 | $75.00 | $1.50 | $18.75 |
| Sonnet | $3.00 | $15.00 | $0.30 | $3.75 |
| Haiku | $0.80 | $4.00 | $0.08 | $1.00 |

## Configuration

Key constants defined in `src/lib/config.ts`:

| Setting | Value | Notes |
|---------|-------|-------|
| WebSocket URL | `ws://localhost:4001` | Override with `NEXT_PUBLIC_WS_URL` env var |
| Reconnect (initial) | 2s | Exponential backoff |
| Reconnect (max) | 30s | |
| Activity log max | 100 entries | |
| Tool calls displayed | 20 per agent | |
| Default context window | 1M tokens | |
| Cost projection window | 60s | Sliding window |
| Budget warning | 80% | Amber pulse |
| Budget critical | 95% | Red pulse |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | `4001` | WebSocket server port. Changing this requires updating `WS_ALLOWED_ORIGINS` in `scripts/lib/config.ts`. |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:4001` | Client WebSocket connection URL. Must match `WS_PORT`. |

See `.env.example` for a template. Origin allowlist is hardcoded in `scripts/lib/config.ts`.

## Session Recording & Replay

1. Click **REC** in the top bar to start recording agent events.
2. Click **REC** again to stop and download a JSON session file.
3. Click **LOAD** to load a previously recorded session.
4. Use transport controls: play/pause, speed (0.5x-4x), and the seek slider.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Deselect agent |
| `F` | Fit graph to view |
| `Up` / `Down` | Navigate agents |

## Project Structure

```
agents/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
├── README.md
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx              # Root layout with neon theme
│   │   └── page.tsx                # Dashboard page
│   ├── components/
│   │   ├── Dashboard.tsx           # Main dashboard container
│   │   ├── TopBar.tsx              # Header with stats, recording, replay load
│   │   ├── AgentList.tsx           # Left sidebar agent list
│   │   ├── AgentGraph.tsx          # D3.js force-directed graph canvas
│   │   ├── AgentDetail.tsx         # Right sidebar detail panel
│   │   ├── ActivityStream.tsx      # Bottom activity log
│   │   ├── GraphControls.tsx       # Fit-to-view, type filters, heatmap toggle
│   │   ├── MiniMap.tsx             # Graph overview navigation
│   │   ├── Timeline.tsx            # Timeline view mode
│   │   ├── TeamPanel.tsx           # Team grouping panel
│   │   ├── ErrorBoundary.tsx       # React error boundary wrapper
│   │   ├── ReplayBar.tsx           # Session replay transport controls
│   │   ├── LogViewer.tsx           # Modal conversation log viewer
│   │   ├── CostProjection.tsx      # Cost burn rate and budget alerts
│   │   ├── HeatmapControls.tsx     # Heatmap metric selector
│   │   ├── ErrorDrillDown.tsx      # F2: Error cascade drill-down modal
│   │   ├── LiveMetrics.tsx         # F4: Real-time sparkline metrics panel
│   │   ├── AnnotationOverlay.tsx   # F6: Per-agent annotation overlay
│   │   ├── DiffViewer.tsx          # F8: File modification viewer
│   │   ├── ExportModal.tsx         # F10: Session export (JSON/CSV/MD)
│   │   └── SessionComparison.tsx   # F14: Side-by-side session comparison
│   ├── hooks/
│   │   ├── useWebSocket.ts         # WebSocket client with reconnection
│   │   ├── useReplay.ts            # Replay engine tick loop
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │   ├── useFilteredAgents.ts    # Agent filtering logic
│   │   ├── useSoundNotifications.ts # Audio alert hook
│   │   └── useMetricSampler.ts     # F4: Live metrics sampling hook
│   ├── lib/
│   │   ├── types.ts                # TypeScript types and interfaces
│   │   ├── store.ts                # Zustand store
│   │   ├── config.ts               # Configuration constants
│   │   ├── colors.ts               # Color maps (agent, status, budget, heatmap)
│   │   ├── validation.ts           # Event validation utilities
│   │   ├── utils.ts                # Formatting and utility functions
│   │   ├── costs.ts                # Token cost calculation (per-model pricing)
│   │   ├── costProjection.ts       # Burn rate and budget projection
│   │   ├── d3/
│   │   │   ├── index.ts            # D3 barrel exports
│   │   │   ├── renderNode.ts       # D3 node rendering
│   │   │   ├── updateLinks.ts      # D3 edge/link rendering
│   │   │   ├── heatmap.ts          # D3 heatmap color scale and rendering
│   │   │   └── layouts.ts          # F12: Tree, radial, hierarchical layouts
│   │   └── __tests__/              # 11 test files, 191 tests
│   └── styles/
│       ├── neon.css                # Custom neon glow CSS utilities
│       └── responsive.css          # F13: Responsive breakpoint styles
├── scripts/
│   ├── ws-server.ts                # Standalone WebSocket server
│   ├── mock-agents.ts              # Mock agent simulator
│   └── lib/
│       ├── agent-state.ts          # Server-side agent state management
│       ├── config.ts               # Server configuration
│       ├── discovery.ts            # Agent JSONL file discovery
│       ├── file-reader.ts          # JSONL file reader/watcher
│       └── log-reader.ts           # Conversation log parser
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-03-26-agent-monitor-design.md
        └── plans/
            └── 2026-03-26-dashboard-features.md
```

## Development

```bash
# Run the test suite
npm test

# Run tests in watch mode
npm run test:watch

# Type check the project
npm run type-check
```
