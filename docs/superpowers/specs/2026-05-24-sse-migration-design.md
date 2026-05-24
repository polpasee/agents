# SSE Migration — Replacing WebSocket with Server-Sent Events

**Status:** Draft — pending user review
**Date:** 2026-05-24

---

## Context

The dashboard currently runs two processes:

- **Next.js dev server** on port `4000` — serves the UI and the existing `GET /api/costs`, `GET /api/usage` routes.
- **`scripts/ws-server.ts`** on port `4001` — a `ws.WebSocketServer` that polls `~/.claude/projects/*.jsonl`, owns the in-memory agent state, and pushes `ServerEvent` messages to connected viewers.

Two ports has been a source of pain on LAN/mobile (commit `f3a05b2` and the earlier WS-from-origin fix). Each phone-on-LAN scenario requires the client to derive a separate `ws://host:4001` URL, the server to bind `0.0.0.0`, and `verifyClient` to accept the LAN origin. The mobile disconnect issue has persisted despite those fixes.

The dashboard's data flow is one-way (server → client). The three apparent client → server flows on WS are:

1. **`ping`** — 30 s heartbeat, transport-level only.
2. **`log:request`** — when a user clicks an agent, the client asks for its JSONL log.
3. **`annotation:add` / `annotation:remove`** — collaborative annotations (F6 feature).

None of these need a duplex stream. The heartbeat is replaced by SSE's built-in keepalive; log fetch and annotation mutations become plain HTTP requests.

## Goals

- **One port (`4000`), one process.** `npm run dev` starts everything.
- **Preserve all existing dashboard functionality** — state stream, log viewer, annotations, replay, costs, usage.
- **Fewer reliability failure modes on mobile/LAN.** SSE is plain HTTP with browser-native auto-reconnect.
- **Smaller diff at the state layer.** `scripts/lib/agent-state.ts` should survive almost intact; only the `viewers` set changes element type.

## Non-Goals

- No `Last-Event-ID` resume. Snapshot-on-(re)connect is sufficient because the server already holds the resolved state in memory.
- No HTTP/2 multiplexing concerns (Next.js dev is HTTP/1.1; ≤ 6 concurrent SSE clients is fine).
- No production multi-worker concerns (single-user local dashboard).
- No protocol version bump. The wire-format change (removing `pong`) is technically backwards-incompatible, but there is one client and one server in one repo.
- No phased coexistence — single-PR big-bang on a feature branch.

## Architecture

### Before

```
Browser
  │  http://host:4000  (page)
  │  ws://host:4001    (live state)
  ▼
Next.js (:4000)             ws-server (:4001)
  • UI                        • WebSocketServer
  • /api/costs                • Polls ~/.claude/projects/*.jsonl
  • /api/usage                • Owns agents/edges/teams/viewers
                              • ccstatusline refresh
                              • Annotation store
```

### After

```
Browser
  │  http://host:4000  (page + SSE + all API)
  ▼
Next.js (:4000)
  • UI
  • src/app/api/stream/route.ts          (SSE — replaces WS)
  • src/app/api/logs/[agentId]/route.ts  (GET — replaces log:request)
  • src/app/api/annotations/route.ts     (POST — replaces annotation:add)
  • src/app/api/annotations/[id]/route.ts (DELETE — replaces annotation:remove)
  • src/app/api/costs/route.ts           (unchanged)
  • src/app/api/usage/route.ts           (unchanged)
  • src/instrumentation.ts               (starts polling loops once)
```

The `npm run ws-server` script, the `ws` and `@types/ws` dependencies, and the entire `scripts/ws-server.ts` file are deleted.

## API Surface

| Method + Path | Replaces | Body / Response |
|---|---|---|
| `GET /api/stream` | WS `state:sync` + live broadcast | SSE stream. Server sends `state:sync` then `annotation:sync` on connect, then live `state:update` / `state:remove` / `annotation:update` / `log:response` / `log:error` as they happen. Keepalive comment (`: keepalive\n\n`) every 15 s. |
| `GET /api/logs/[agentId]` | WS `log:request` → `log:response` | `200 { entries: LogEntry[] }`, `404 { error: "Agent not found or no log file available" }`, or `500 { error: "Failed to read log: ..." }`. |
| `POST /api/annotations` | WS `annotation:add` | Body: `Annotation`. Validated via existing `sanitizeAnnotation` logic (extracted from `ws-server.ts`). `201 { annotation }` on success, `400 { error }` on validation failure, `409 { error: "Annotation id already exists" }` on duplicate id. Side effect: `broadcast({ type: "annotation:update", action: "add", annotation })`. |
| `DELETE /api/annotations/[id]` | WS `annotation:remove` | `204 No Content` on success, `404` if id not found. Side effect: `broadcast({ type: "annotation:update", action: "remove", annotation })`. |

## Wire Protocol

Single SSE channel with JSON-discriminated union payloads — preserves the existing `ServerEvent` type verbatim except for the removal of `pong`.

Example stream:

```
data: {"type":"state:sync","agents":[...],"edges":[...],"teams":[...],"protocolVersion":1}

data: {"type":"annotation:sync","annotations":[...]}

data: {"type":"state:update","event":{"type":"agent:tool_call","agentId":"main-x","tool":"Read"},"timestamp":1735000000000}

: keepalive

data: {"type":"state:remove","agentId":"main-x"}
```

### Type changes (`src/lib/types.ts`)

- **Remove** `export type ClientEvent = ...` entirely.
- **Remove** `| { type: "pong" }` from the `ServerEvent` union.
- Everything else (`AgentEvent`, `AgentState`, `EdgeState`, `TeamState`, `Annotation`, `LogEntry`, `PROTOCOL_VERSION`, etc.) stays unchanged.

### Resume semantics

No `Last-Event-ID`, no server-side ring buffer. Every (re)connect → server immediately sends `state:sync` with the current snapshot, then `annotation:sync` if any annotations exist, then live deltas as they happen. The snapshot is the source of truth; deltas missed during a disconnect are recovered by the next snapshot. Matches existing WS behavior.

### Keepalive

Server writes `: keepalive\n\n` every 15 seconds per connected client. This is an SSE comment, not a data event — the browser silently ignores it but it keeps proxies and load balancers from idling the connection out.

## File Changes

### Created

- `src/app/api/stream/route.ts` — SSE GET handler. Adds a viewer to the shared `viewers` set, writes initial `state:sync` + (optional) `annotation:sync`, schedules a 15 s keepalive interval, removes the viewer on stream abort.
- `src/app/api/logs/[agentId]/route.ts` — GET handler that calls `readAgentLog(getAgentFilePath(agentId))`.
- `src/app/api/annotations/route.ts` — POST handler with body validation via extracted `sanitizeAnnotation`.
- `src/app/api/annotations/[id]/route.ts` — DELETE handler.
- `src/instrumentation.ts` — Next.js instrumentation hook; calls `startBackgroundTasks()` exactly once, even across HMR reloads. Located at `src/instrumentation.ts` (sibling to `app/`) per the Next.js convention when using the `src/` layout.
- `scripts/lib/sse-broadcast.ts` — exports `SSEClient` interface (`{ send(data: string): void }`), the shared `viewers: Set<SSEClient>`, and `broadcast(event: ServerEvent)` that fans out to all viewers.
- `scripts/lib/annotation-store.ts` — extracts the `annotationStore: Map<string, Annotation>` and `sanitizeAnnotation` function from `ws-server.ts`.
- `src/hooks/useEventStream.ts` — replaces `useWebSocket.ts`. Uses `new EventSource("/api/stream")`. Keeps the existing 16 ms / 50-event batching for render performance.
- `src/app/api/stream/__tests__/route.test.ts` — TDD tests for SSE behavior.
- `src/app/api/logs/__tests__/route.test.ts` — TDD tests for log fetch.
- `src/app/api/annotations/__tests__/route.test.ts` — TDD tests for annotation lifecycle.
- `src/hooks/__tests__/useEventStream.test.tsx` — TDD tests for the client hook.

### Modified

- `scripts/lib/agent-state.ts` — import `broadcast` and `viewers` from new `sse-broadcast.ts`. Delete the `WebSocket` import and the local `viewers: Set<WebSocket>` declaration. Polling-loop bodies (`updateAgentStatus`, `processEntry`, etc.) are untouched. Add an exported `startBackgroundTasks()` that wraps the `pollLoop`/`usagePollLoop` IIFE moved from `ws-server.ts`, guarded by a `started` flag on the `globalThis` singleton.
- `src/lib/types.ts` — delete `ClientEvent`, delete `pong` variant from `ServerEvent`.
- `src/lib/validation.ts` — delete `isValidClientEvent`. Keep `isValidServerEvent` (still used to validate SSE payloads client-side).
- `src/lib/config.ts` — delete `getWsUrl`, `WS_URL_ENV`, `WS_URL_SSR_FALLBACK`, `WS_PORT` (client copy), `WS_RECONNECT_DELAY_MS`, `WS_RECONNECT_MAX_DELAY_MS`. Keep `WS_BATCH_INTERVAL_MS` and `WS_BATCH_MAX_SIZE`, renamed to `STREAM_BATCH_INTERVAL_MS` and `STREAM_BATCH_MAX_SIZE` (they describe a client-side render batch, not the transport).
- `scripts/lib/config.ts` — delete `WS_PORT`, `WS_ALLOWED_ORIGINS`, `isAllowedOrigin`. Other constants (`POLL_INTERVAL_MS`, `STATUS_RUNNING_THRESHOLD_MS`, annotation caps, usage refresh constants) stay.
- `src/components/Dashboard.tsx` — rename `useWebSocket()` → `useEventStream()`. Update annotation-add/remove callsites and log-fetch callsites to use `fetch()` instead of `sendWsMessage()`. (Exact line numbers determined at implementation time.)
- `scripts/mock-agents.ts` — **rewrite** to seed JSONL files into `~/.claude/projects/-mock-agents-demo/<fake-session>.jsonl` matching the on-disk format that `discovery.ts` already parses. Writing inside the existing `PROJECTS_DIR` means discovery picks the mock files up via the real polling path without any code changes to `discovery.ts`. The `-mock-agents-demo` prefix is a deliberately clear, easily-grep-and-rm-able namespace; mock-agents cleans up its own files on exit (and on next invocation, to avoid stale mock sessions accumulating). `WS_URL` env var goes away.
- `package.json` — delete the `"ws-server"` script. Delete `"ws"` and `"@types/ws"` from dependencies.
- `.env*` (if present) — delete `WS_HOST`, `NEXT_PUBLIC_WS_URL`, `WS_PORT`.
- `README.md` (if it documents the two-process setup) — update to reflect single-process model.

### Deleted

- `scripts/ws-server.ts`
- `src/hooks/useWebSocket.ts`
- `src/hooks/__tests__/useWebSocket.test.tsx` (if exists)

## HMR-Safe Singleton

Next.js dev mode re-evaluates modules on file save. Module-level `Map`/`Set` declarations would be wiped on every reload, losing the polling-loop state and disconnecting all SSE viewers. The fix is the standard pattern (used by Prisma, Next.js itself for the route cache, etc.) — stash the singleton on `globalThis`:

```ts
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitor: {
    agents: Map<string, AgentState>;
    edges: EdgeState[];
    teams: Map<string, TeamState>;
    viewers: Set<SSEClient>;
    annotations: Map<string, Annotation>;
    agentLastModified: Map<string, number>;
    removedAgentIds: Map<string, number>;
    agentFilePaths: Map<string, string>;
    started: boolean;
  } | undefined;
}

const store = (globalThis.__agentMonitor ??= {
  agents: new Map(),
  edges: [],
  teams: new Map(),
  viewers: new Set(),
  annotations: new Map(),
  agentLastModified: new Map(),
  removedAgentIds: new Map(),
  agentFilePaths: new Map(),
  started: false,
});

export const { agents, edges, teams, viewers, agentLastModified, removedAgentIds, agentFilePaths } = store;
```

`startBackgroundTasks()` checks `store.started`; if true it returns immediately. Otherwise it sets `started = true` and launches `pollLoop()` + `usagePollLoop()`.

## Testing Strategy

TDD discipline — failing tests first, then implementation. Run order:

1. **`useEventStream.test.tsx`** (red) — mock `EventSource` (`vi.stubGlobal`), assert each `ServerEvent` variant produces the expected store mutation. Existing `useWebSocket` test logic translates directly.
2. **`route.test.ts` for `/api/stream`** (red) — invoke the Next.js route handler, parse the SSE frames from the returned `Response.body` stream, assert initial `state:sync`, then trigger a `broadcast()` and assert `state:update` arrives, then abort and assert the viewer leaves the set.
3. **`route.test.ts` for `/api/logs`** (red) — seed an agent file path, hit `GET /api/logs/<id>`, assert `entries`. Hit with unknown id, assert 404.
4. **`route.test.ts` for `/api/annotations`** (red) — POST valid, assert 201 and broadcast. POST malformed (bad id pattern, oversized text), assert 400. POST duplicate id, assert 409. DELETE existing, assert 204 and broadcast. DELETE missing, assert 404. Over-cap eviction.
5. Implementation makes them green.
6. **Existing tests must still pass**: `agent-state.test.ts`, `discovery.test.ts`, `store.test.ts`, `colors.test.ts`, `uiSlice.test.ts` — none of these exercise the WS transport directly. Any breakage indicates accidental scope creep.

Target: 557 tests currently pass; after migration, expect ~ 560–570 (a few new SSE/route tests, minus deleted WS-specific ones).

## mock-agents Rewrite

`scripts/mock-agents.ts` currently opens a WS connection and sends `agent:register` / `agent:tool_call` events. But `ws-server.ts`'s `isValidClientEvent` only accepts `log:request`, `annotation:add`, `annotation:remove`, `ping` — so these inbound `AgentEvent`s have been **silently dropped at the validator** since strict client-event validation landed. The script is currently dead code.

Rewrite to seed JSONL files into `~/.claude/projects/-mock-agents-demo/<fake-session>.jsonl` matching the on-disk format that `discovery.ts` already parses. Writing inside `PROJECTS_DIR` (the existing watched directory) means discovery polls them via the real code path without any change to `discovery.ts`. The `-mock-agents-demo` prefix is a clear namespace, easily greppable and removable. mock-agents removes its own files on startup and on `SIGINT` to prevent stale mock sessions from leaking into the user's real session list. This:

- Removes the parallel inject path that was masking the WS-validator behavior change.
- Exercises the JSONL parser and discovery logic — more realistic test data.
- Survives the WS removal without needing any new admin endpoint.

The `-mock-agents-demo` prefix keeps mock files distinct from real Claude Code sessions and trivially removable. `WS_URL` env var goes away.

## Risks and Open Questions

| Risk | Mitigation |
|---|---|
| Next.js dev HMR drops the polling singleton mid-session | `globalThis` stash + `started` flag (see HMR section). Tested by editing a non-server file while the dashboard is running and confirming the agent count doesn't reset. |
| SSE connection eaten by an intermediate proxy on long idle | 15 s keepalive comment frames. |
| `EventSource` auto-reconnect spams the server during dev restart | Server's auto-restart on file change is fast (≤ 2 s); `EventSource`'s default `retry: 3000` is appropriate. No throttling needed. |
| Browser limit of 6 concurrent SSE streams per origin | Only one stream per dashboard tab. Multiple tabs cost separate connections but the dashboard is rarely opened more than once. Acceptable. |
| TypeScript types reference `ws` after deletion | Deletion of `import { WebSocket } from "ws"` in `scripts/lib/agent-state.ts` and the corresponding type uses. `tsc --noEmit` will catch any miss. |
| `EventSource` not available in SSR | `useEventStream` runs inside `useEffect`; never executes during SSR. Same pattern as the existing WS hook. |
| Discovery polling continues after dashboard is closed (no viewers) | Acceptable — the polling cost is small and bounded; restarting the daemon on first viewer adds complexity without benefit for a single-user dashboard. |

## Sequence Diagram — New connect flow

```
Browser                            Next.js (:4000)              JSONL files
   │                                     │                            │
   │ GET /                               │                            │
   ├────────────────────────────────────►│                            │
   │ HTML/JS                             │                            │
   │◄────────────────────────────────────┤                            │
   │                                     │                            │
   │ GET /api/stream (Accept: text/event-stream)                      │
   ├────────────────────────────────────►│                            │
   │                                     │ viewers.add(client)        │
   │ data: {"type":"state:sync",...}     │                            │
   │◄────────────────────────────────────┤                            │
   │                                     │                            │
   │   (every 1.5 s)                     │ pollLoop tick              │
   │                                     ├───────────────────────────►│
   │                                     │ new events processed       │
   │                                     │                            │
   │ data: {"type":"state:update",...}   │ broadcast() iterates       │
   │◄────────────────────────────────────┤ viewers, .send() each      │
   │                                     │                            │
   │   (user clicks agent for log)       │                            │
   │ GET /api/logs/main-abc              │                            │
   ├────────────────────────────────────►│                            │
   │ {"entries":[...]}                   │ readAgentLog(...)          │
   │◄────────────────────────────────────┤                            │
   │                                     │                            │
   │   (user adds annotation)            │                            │
   │ POST /api/annotations               │                            │
   ├────────────────────────────────────►│                            │
   │ 201 {"annotation":{...}}            │ annotations.set(...)       │
   │◄────────────────────────────────────┤ broadcast(annotation:update│
   │                                     │   to all viewers)          │
   │ data: {"type":"annotation:update",  │                            │
   │   action:"add",...}                 │                            │
   │◄────────────────────────────────────┤                            │
```

## Migration Acceptance Criteria

The feature branch is mergeable when all of the following are true:

1. `npm run dev` starts a single Next.js process on port `4000`. No `npm run ws-server` is required.
2. The dashboard loads at `http://localhost:4000` and immediately shows the current agents in the topology (verified by checking the WebSocket-style debug overlay is gone and topology nodes appear).
3. Reconnect after a 30-second server pause is automatic (browser `EventSource` handles it) and the topology re-syncs from the next `state:sync`.
4. Clicking an agent opens the log viewer with entries populated (validates `GET /api/logs/[agentId]`).
5. Adding and removing an annotation works and propagates to a second browser tab in real time (validates POST/DELETE + SSE broadcast round-trip).
6. `npm run test` passes. Test count is within ±10 of the pre-migration baseline (557).
7. `npm run type-check` passes.
8. A second device on the LAN (phone at `http://<mac-lan-ip>:4000`) loads the dashboard and receives live updates. This is the primary motivating scenario.
9. `grep -r "WebSocket\|ws://\|WS_PORT" src/ scripts/ | grep -v __tests__` returns no hits in production code. `package.json` no longer lists `ws` or `@types/ws`.

## Out of Scope (explicit)

- The mobile-tablet view, sound notifications, replay UI, cost projections, and any other dashboard feature not tied to the WS transport. The migration must not modify them.
- D3 force-directed topology code (`src/lib/d3/`). React-free, transport-agnostic, untouched.
- The cost-history accumulator (`scripts/lib/cost-history.ts`) and webhooks (`scripts/lib/webhooks.ts`). They don't depend on the WS server's connection lifecycle.
