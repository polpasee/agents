# Claude Agent Monitor

**Real-time monitoring dashboard for Claude Code sub-agents and Agent SDK applications.**

Built with Next.js 16, React 19, TypeScript, D3.js, Zustand, and Server-Sent Events (SSE). Features a cyber/neon aesthetic with force-directed graph visualization.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js) ![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript) ![D3.js](https://img.shields.io/badge/D3.js-7-F9A03C?style=flat-square&logo=d3.js) ![Zustand](https://img.shields.io/badge/Zustand-5-433E38?style=flat-square) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss) ![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?style=flat-square&logo=vitest)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (serves the dashboard on port 4000)
npm run dev

# 3. Open the dashboard
open http://localhost:4000

# 4. (Optional) Seed mock agents for development
npm run mock-agents
```

The Next.js server is the only process: it serves the UI, runs the background
JSONL poller (via the instrumentation hook), and exposes the SSE stream. There
is no separate server to start.

## Security & Trust Model

> **Warning:** This dashboard is localhost-only and transmits raw Claude Code transcripts including conversation history, tool inputs/outputs, and file contents **without redaction**. Do not expose port 4000 to untrusted networks. Transcripts may contain credentials, API keys, or sensitive file contents. See [SECURITY.md](SECURITY.md) for details.

## Architecture

```
  Claude Code            ~/.claude/projects/**/*.jsonl  +  ~/.claude/teams/**
      |  writes                          |
      v                                  v
  [ JSONL files ] <-- polls --  [ Next.js server :4000 ]  --SSE-->  [ EventSource ]
                                         |                                |
                                         v                                v
                          [ instrumentation.ts        ]      [ React Dashboard ]
                          [ background-tasks.ts (poll)]      [ D3 topology +   ]
                          [ discovery.ts / teams-disc.]      [ side panels     ]
                          [ file-reader / agent-state ]
                          [ sse-broadcast::broadcast()]
```

**How It Works**: Claude Code writes structured transcripts to `~/.claude/projects/<project>/<session>.jsonl` for the main agent and parallel subagent files in the same directory; team metadata lives under `~/.claude/teams/`. When the Next.js server boots, `src/instrumentation.ts` starts a background poller (`scripts/lib/background-tasks.ts`) that discovers and reads these files via `scripts/lib/discovery.ts`, `scripts/lib/teams-discovery.ts`, and `scripts/lib/file-reader.ts`, polling every 1.5 seconds for new content. New JSONL entries are parsed into typed `AgentEvent`s by `scripts/lib/agent-state.ts`, which also tracks derived state (edge type, stale detection, team membership). Processed events are broadcast to all connected dashboard clients over SSE via `scripts/lib/sse-broadcast.ts::broadcast`, fanning out through the `GET /api/stream` route (`src/app/api/stream/route.ts`). The dashboard subscribes through `src/hooks/useEventStream.ts` (a native `EventSource`) and feeds events into the Zustand store, driving a real-time D3 force-directed topology and supporting side panels.

## Integration Modes

| Mode | How agents are picked up | When to use |
|------|--------------------------|-------------|
| File-watch (default) | The background poller scans `~/.claude/projects/**/*.jsonl` (and `~/.claude/teams/**`) automatically | Standard Claude Code usage — no agent-side changes required |
| Mock seeding (dev) | `scripts/mock-agents.ts` writes synthetic JSONL files into `~/.claude/projects/-mock-agents-demo/` so the same poller discovers them | Local development and demos without a live Claude Code session |

## Features

### Core

- **Real-Time Agent Graph** — D3.js force-directed graph with animated nodes color-coded by agent type, pulsing active rings, data flow particles along edges, and hover tooltips.
- **Agent List Sidebar** — Left panel with a scrollable, filterable agent list and color-coded status dots. Click to select.
- **Agent Detail Panel** — Right panel displaying status, model, slug, team, task, token usage (with cache read/write), duration, estimated cost, recent tool calls, and summary.
- **Activity Stream** — Bottom panel with a timestamped event log and auto-scrolling.
- **Top Bar** — Global stats (total/active/completed/error agents, total cost), SSE connection status indicator, and session recording controls.
- **Timeline View** — Alternative view mode; toggle between graph and timeline.
- **Mini Map** — Overview navigation widget for the graph canvas.
- **Graph Controls** — Fit-to-view button, agent type filters to toggle visibility per type.
- **Team Support** — Team panel showing team groupings, members, and stats. Includes a team-lead agent type.
- **Keyboard Shortcuts** — Escape (deselect), F (fit to view), Arrow Up/Down (navigate agents).
- **Sound Notifications** — Audio alerts for agent events.
- **Error Boundaries** — React error boundaries around every major component for graceful failure handling.

### Advanced (Foundation)

- **Session Replay** — Load recorded JSON session files and replay with transport controls (play/pause/seek), speed control (0.5x / 1x / 2x / 4x), and a progress slider. Use the LOAD button in the top bar.
- **Agent Log Viewer** — Modal viewer for full conversation logs (user/assistant/system messages) with collapsible tool calls showing args and results, plus search functionality. Triggered via the LOG button in the agent detail panel. Fetches log entries over HTTP via `GET /api/logs/[agentId]`.
- **Cost Projections & Alerts** — Real-time burn rate ($/min), projected total cost, and a configurable budget threshold persisted in localStorage. Visual warnings pulse amber at 80% and red at 95% of budget.
- **Performance Heatmap** — Graph overlay mode coloring nodes by performance metric (green = healthy, red = bottleneck). Metrics include idle ratio, token efficiency, time to first tool, and average tool latency. Toggle via the HEAT button.

### Monitoring & Observability (F1–F4)

- **F1: Blocking Edge Visualizations** — Red dashed edges with animated stroke and pulsing opacity to indicate blocked dependencies in the agent graph. Includes arrowhead markers and a topology key legend.
- **F2: Error Drill-Down** — Modal showing error message, cascade chain (agents affected by an error), and last tool calls for errored agents. Triggered via VIEW ERROR button in agent detail panel.
- **F3: Agent Efficiency Scoring** — Per-agent 0-100 efficiency score combining token efficiency, tool success rate, and completion speed. Displayed in agent detail with a color-coded progress ring.
- **F4: Live Metrics Dashboard** — Collapsible panel with 4 D3 sparkline area charts showing active agent count, tokens/sec, cost/min, and total cost over time. Toggle via METRICS button in top bar.

### Collaboration (F5–F7)

- **F5: Multi-Session Support** — Session selector in top bar for filtering agents by session. Supports all-session or per-session views.
- **F6: Annotation Overlay** — Per-agent text annotations. Add/remove via HTTP (`POST /api/annotations`, `DELETE /api/annotations/[id]`); changes are broadcast over SSE in real time to all connected viewers.
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
| `npm run mock-agents` | Seed mock agent JSONL files for development |
| `npm run test` | Run tests with Vitest |
| `npm run test:watch` | Watch mode for tests |
| `npm run type-check` | TypeScript type check |
| `npm run coverage` | Run tests with coverage report |

## Event Protocol

Live state flows **server → client over SSE** (`GET /api/stream`). Client → server
actions (annotations, log fetches) are plain **HTTP REST** routes. The wire
contract lives in `src/lib/types.ts` (`ServerEvent`, `AgentEvent`).

### Server → Client (SSE events)

Each SSE frame is a JSON-encoded `ServerEvent`:

| Event | Description | Key fields |
|-------|-------------|------------|
| `state:sync` | Full state snapshot on connect (and after EventSource reconnect) | `agents`, `edges`, `teams`, `workflows?`, `protocolVersion?` |
| `state:update` | Incremental agent event forwarded to all viewers | `event` (AgentEvent), `timestamp` |
| `state:remove` | Agent removed from active state | `agentId` |
| `annotation:sync` | Full annotation list sent after `state:sync` on connect | `annotations` |
| `annotation:update` | Single annotation added or removed | `annotation`, `action` (`"add"` or `"remove"`) |
| `workflow:update` | A workflow run was added or updated | `workflow` (WorkflowRunState) |
| `workflow:remove` | A workflow run was removed | `runId` |

The `event` payload inside `state:update` is an `AgentEvent`, one of:

| Variant | Description |
|---------|-------------|
| `agent:register` | Agent appears with agentId, parentId, agentType, task, sessionId, slug, model, teamId, metadata |
| `agent:status` | Status change (running / waiting / idle / completed / error) |
| `agent:tool_call` | Tool call with tool name, args, result |
| `agent:tokens` | Token usage update (input, output, cacheRead, cacheCreate, contextWindow) |
| `agent:message` | Inter-agent message (fromId, toId, content) |
| `agent:complete` | Agent finished (summary, duration) |

> **Heartbeat**: keepalive is handled at the SSE transport layer with `: keepalive\n\n` comments every 15s. There are no protocol-level ping/pong messages.

> **Protocol version**: `state:sync` carries `protocolVersion: 1` (defined as `PROTOCOL_VERSION` in `src/lib/types.ts`). Clients warn once — but do not disconnect — if this field is absent or does not match the expected value. Incrementing `PROTOCOL_VERSION` signals a backwards-incompatible change; adding new optional fields or new event variants does not require a bump.

### Client → Server (HTTP REST)

| Action | Request | Notes |
|--------|---------|-------|
| Add annotation | `POST /api/annotations` with an `Annotation` body | Broadcasts `annotation:update` (`add`) over SSE |
| Remove annotation | `DELETE /api/annotations/[id]` | Broadcasts `annotation:update` (`remove`) over SSE |
| Fetch agent log | `GET /api/logs/[agentId]` | Returns `{ entries }` (parsed conversation log) |

All route handlers enforce an origin allowlist via `scripts/lib/origin-check.ts::isAllowedRequestOrigin`.

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

Configuration is compiled in, not environment-driven. Client constants live in
`src/lib/config.ts`; server constants live in `scripts/lib/config.ts`.

Client (`src/lib/config.ts`):

| Setting | Value | Notes |
|---------|-------|-------|
| SSE batch flush interval | 16ms | Coalesce `state:update` render churn (~1 frame) |
| SSE batch max size | 50 events | Force-flush the buffer at this many events |
| Activity log max | 100 entries | |
| Tool calls displayed | 20 per agent | |
| Default context window | 1M tokens | |
| Cost projection window | 60s | Sliding window |
| Budget warning | 80% | Amber pulse |
| Budget critical | 95% | Red pulse |
| Recording cap | 50,000 events | In-memory replay buffer |

Server (`scripts/lib/config.ts`):

| Setting | Value | Notes |
|---------|-------|-------|
| Projects dir | `~/.claude/projects` | JSONL discovery root |
| Teams dir | `~/.claude/teams` | Team metadata root |
| Poll interval | 1500ms | Background poller tick |
| Full rescan cadence | every 4th poll | Discover new sessions roughly every 6s |

SSE reconnection is handled natively by the browser `EventSource`; there is no
custom reconnect/backoff setting.

## Environment Variables

**None are required.** The app reads no user-facing environment variables — the
projects/teams paths and all tunables are compiled in (see Configuration above).
The dev server binds `0.0.0.0:4000` (see the `dev` script in `package.json`),
and route handlers restrict origins via `scripts/lib/origin-check.ts`
(localhost and private/RFC1918 LAN hosts only). See `.env.example` for details.

## Session Recording & Replay

1. Click **REC** in the top bar to start recording agent events.
2. Click **REC** again to stop and download a JSON session file.
3. Click **LOAD** to load a previously recorded session.
4. Use transport controls: play/pause, speed (0.5x-4x), and the seek slider.

> **Note**: Recorded sessions are held in browser memory, capped at **50,000 events** (`RECORDING_MAX_EVENTS` in `src/lib/config.ts`). Once the cap is reached, the oldest events are dropped. At ~20 events/sec sustained, that's ~40 minutes of recording. Stop and download recordings periodically during long sessions.

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
│   │   ├── page.tsx                # Dashboard page
│   │   └── api/
│   │       ├── stream/route.ts     # GET /api/stream — SSE live-state endpoint
│   │       ├── annotations/        # POST + [id]/DELETE annotation routes
│   │       ├── logs/[agentId]/     # GET conversation log for an agent
│   │       ├── costs/route.ts      # Cost-history endpoint
│   │       └── usage/route.ts      # ccstatusline usage endpoint
│   ├── instrumentation.ts          # Next.js boot hook → starts the background poller
│   ├── components/
│   │   ├── AgentGraph/             # D3.js force-directed graph canvas (orchestrator + extracted hooks)
│   │   │   ├── index.tsx           # Component entry point; composes the hooks below
│   │   │   ├── refs.ts             # Shared D3 ref container
│   │   │   ├── useTopologyEffect.ts
│   │   │   ├── useNodeVisualsEffect.ts
│   │   │   ├── useToolNodesEffect.ts
│   │   │   └── ...                 # see src/components/AgentGraph/ for full list
│   │   ├── Dashboard.tsx           # Main dashboard container
│   │   ├── TopBar.tsx              # Header with stats, recording, replay load
│   │   ├── AgentList.tsx           # Left sidebar agent list
│   │   ├── AgentDetail.tsx         # Right sidebar detail panel
│   │   ├── ActivityStream.tsx      # Bottom activity log
│   │   ├── Timeline.tsx            # Timeline view mode
│   │   ├── TeamPanel.tsx           # Team grouping panel
│   │   ├── ErrorBoundary.tsx       # React error boundary wrapper
│   │   ├── ReplayBar.tsx           # Session replay transport controls
│   │   ├── LogViewer.tsx           # Modal conversation log viewer
│   │   ├── CostProjection.tsx      # Cost burn rate and budget alerts
│   │   ├── ErrorDrillDown.tsx      # Error cascade drill-down modal
│   │   ├── LiveMetrics.tsx         # Real-time sparkline metrics panel
│   │   ├── AnnotationOverlay.tsx   # Per-agent annotation overlay
│   │   ├── DiffViewer.tsx          # File modification viewer
│   │   ├── ExportModal.tsx         # Session export (JSON/CSV/MD)
│   │   ├── SessionComparison.tsx   # Side-by-side session comparison
│   │   └── ...                     # see src/components/ for full list
│   ├── hooks/
│   │   ├── useEventStream.ts       # SSE EventSource client → Zustand store
│   │   ├── useReplay.ts            # Replay engine tick loop
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │   ├── useFilteredAgents.ts    # Agent filtering logic
│   │   ├── useSoundNotifications.ts # Audio alert hook
│   │   └── useMetricSampler.ts     # Live metrics sampling hook
│   ├── lib/
│   │   ├── types.ts                # SSE protocol contract (ServerEvent, AgentEvent)
│   │   ├── store.ts                # Re-export barrel for src/lib/store/
│   │   ├── store/                  # Zustand store slices
│   │   │   ├── index.ts            # Composed store
│   │   │   ├── agentSlice.ts       # Agent/edge/team domain state + event reducer
│   │   │   ├── replaySlice.ts      # Replay clock and session state
│   │   │   ├── uiSlice.ts          # UI flags (heatmap, layout, mobile) + localStorage
│   │   │   ├── panelSlice.ts       # Overlay panel visibility
│   │   │   ├── eventHandlers.ts    # Per-event handler functions
│   │   │   ├── helpers.ts          # Shared store utilities
│   │   │   └── types.ts            # Store-internal TypeScript types
│   │   ├── config.ts               # Configuration constants (RECORDING_MAX_EVENTS, etc.)
│   │   ├── colors.ts               # Color maps (agent, status, budget, heatmap)
│   │   ├── validation.ts           # Event validation utilities
│   │   ├── utils.ts                # Formatting and utility functions
│   │   ├── costs.ts                # Token cost calculation (per-model pricing)
│   │   ├── costProjection.ts       # Burn rate and budget projection
│   │   ├── efficiency.ts           # Agent efficiency score calculation
│   │   ├── d3/
│   │   │   ├── index.ts            # D3 barrel exports
│   │   │   ├── renderNode.ts       # D3 node rendering
│   │   │   ├── updateLinks.ts      # D3 edge/link rendering
│   │   │   ├── heatmap.ts          # D3 heatmap color scale and rendering
│   │   │   └── layouts.ts          # Tree, radial, hierarchical layouts
│   │   └── __tests__/              # Unit tests
│   └── styles/
│       ├── neon.css                # Custom neon glow CSS utilities
│       └── responsive.css          # Responsive breakpoint styles
├── scripts/
│   ├── mock-agents.ts              # Seeds synthetic JSONL into ~/.claude/projects/ for dev
│   └── lib/
│       ├── background-tasks.ts     # Poll loop started by instrumentation.ts
│       ├── agent-state.ts          # Server-side agent state singleton + SSE viewers set
│       ├── sse-broadcast.ts        # broadcast() — fan ServerEvents out to SSE viewers
│       ├── origin-check.ts         # isAllowedRequestOrigin — route-handler origin allowlist
│       ├── annotation-store.ts     # In-memory annotation store + sanitization
│       ├── config.ts               # Server configuration (PROJECTS_DIR, POLL_INTERVAL_MS, etc.)
│       ├── discovery.ts            # Agent JSONL file discovery under ~/.claude/projects/
│       ├── teams-discovery.ts      # Team discovery under ~/.claude/teams/
│       ├── workflow-scan.ts        # Workflow-run discovery and state
│       ├── file-reader.ts          # JSONL file tail reader
│       └── log-reader.ts           # Conversation log parser
└── docs/
    └── superpowers/                # Historical planning artifacts (pre-implementation specs)
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
