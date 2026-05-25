# SSE Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone WebSocket server (`scripts/ws-server.ts` on port 4001) with a Server-Sent Events endpoint mounted inside the existing Next.js app on port 4000, while preserving all current dashboard functionality (live topology, log viewer, annotations, costs, usage, replay).

**Architecture:** Collapse the two-process model into one. The Next.js process owns everything: UI, all API routes, the JSONL polling loop, the agent-state singleton, the ccstatusline refresh, and the SSE broadcast fan-out. The state singleton is stashed on `globalThis` so Next.js HMR doesn't reset it between hot reloads. `EventSource` (browser-native, auto-reconnect, plain HTTP) replaces the custom WebSocket client and its hand-rolled reconnect backoff. Three client→server WS events become HTTP routes: `log:request` → `GET /api/logs/[agentId]`, `annotation:add` → `POST /api/annotations`, `annotation:remove` → `DELETE /api/annotations/[id]`. The `ping` heartbeat is replaced by SSE keepalive comments.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Zustand (client store), vitest + jsdom (tests). No new runtime dependencies; removes `ws` and `@types/ws`.

**Spec:** `docs/superpowers/specs/2026-05-24-sse-migration-design.md`

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `scripts/lib/sse-broadcast.ts` | **Create** | Defines `SSEClient` interface; owns `viewers: Set<SSEClient>` and `broadcast(event)`. HMR-safe via `globalThis`. |
| `scripts/lib/annotation-store.ts` | **Create** | Extracted from `ws-server.ts`: `annotations` map, `sanitizeAnnotation`. HMR-safe. |
| `scripts/lib/agent-state.ts` | **Modify** | Move agents/edges/teams/agentLastModified/removedAgentIds/agentFilePaths onto `globalThis`. Remove `WebSocket` import; re-export `viewers` and `broadcast` from `sse-broadcast`. Add exported `startBackgroundTasks()` that owns the polling loops. |
| `src/instrumentation.ts` | **Create** | Next.js bootstrap hook; calls `startBackgroundTasks()` exactly once. |
| `src/app/api/stream/route.ts` | **Create** | SSE endpoint. Sends `state:sync` + `annotation:sync` on connect, then live deltas. 15-second keepalive comments. |
| `src/app/api/logs/[agentId]/route.ts` | **Create** | GET handler — reads the agent's JSONL log via existing `readAgentLog`. |
| `src/app/api/annotations/route.ts` | **Create** | POST handler — validates with `sanitizeAnnotation`, stores, broadcasts `annotation:update` (add). |
| `src/app/api/annotations/[id]/route.ts` | **Create** | DELETE handler — removes from store, broadcasts `annotation:update` (remove). |
| `src/hooks/useEventStream.ts` | **Create** | Replaces `useWebSocket.ts`. Uses `EventSource("/api/stream")`. Preserves the 16ms / 50-event batching of `useWebSocket`. |
| `src/components/Dashboard.tsx` | **Modify** | Swap `useWebSocket()` → `useEventStream()`. |
| `src/components/AgentDetail.tsx` | **Modify** | Replace `sendWsMessage({ type: "log:request", ... })` with `fetch("/api/logs/...")`. |
| `src/components/AnnotationOverlay.tsx` | **Modify** | Replace `sendWsMessage` calls with `fetch("/api/annotations", ...)` and `fetch("/api/annotations/...", { method: "DELETE" })`. |
| `src/components/__tests__/Dashboard.test.tsx` | **Modify** | Update mock from `useWebSocket` to `useEventStream`. |
| `src/lib/types.ts` | **Modify** | Delete `ClientEvent` union, delete `\| { type: "pong" }` from `ServerEvent`. |
| `src/lib/validation.ts` | **Modify** | Delete `isValidClientEvent`, delete `pong` case from `isValidServerEvent`. |
| `src/lib/__tests__/validation.extra.test.ts` | **Modify** | Delete tests covering `isValidClientEvent`. |
| `src/lib/config.ts` | **Modify** | Delete `getWsUrl`, `WS_URL_ENV`, `WS_URL_SSR_FALLBACK`, `WS_RECONNECT_*`, client copy of `WS_PORT`. Add `STREAM_BATCH_INTERVAL_MS` / `STREAM_BATCH_MAX_SIZE`. Delete `WS_BATCH_*`. |
| `scripts/lib/config.ts` | **Modify** | Delete `WS_PORT`, `WS_ALLOWED_ORIGINS`, `isAllowedOrigin`. |
| `package.json` | **Modify** | Remove `"ws-server"` script. Remove `"ws"` and `"@types/ws"` from dependencies/devDependencies. |
| `scripts/mock-agents.ts` | **Rewrite** | Seed JSONL files into `~/.claude/projects/-mock-agents-demo/<session>.jsonl`; cleanup on startup and SIGINT. |
| `scripts/ws-server.ts` | **Delete** | Replaced by `src/instrumentation.ts` + Next.js routes. |
| `src/hooks/useWebSocket.ts` | **Delete** | Replaced by `useEventStream.ts`. |

---

## Task 1: Create `sse-broadcast.ts` module

**Files:**
- Create: `scripts/lib/sse-broadcast.ts`
- Test: `scripts/lib/__tests__/sse-broadcast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/__tests__/sse-broadcast.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { viewers, broadcast, type SSEClient } from "../sse-broadcast";
import type { ServerEvent } from "../../../src/lib/types";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    send(data: string) { received.push(data); },
  };
}

describe("sse-broadcast", () => {
  beforeEach(() => {
    viewers.clear();
  });

  it("fans out a single event to every viewer", () => {
    const a = makeClient();
    const b = makeClient();
    viewers.add(a);
    viewers.add(b);

    const event: ServerEvent = { type: "state:remove", agentId: "main-x" };
    broadcast(event);

    const payload = JSON.stringify(event);
    expect(a.received).toEqual([payload]);
    expect(b.received).toEqual([payload]);
  });

  it("does not throw when there are no viewers", () => {
    expect(() => broadcast({ type: "state:remove", agentId: "x" })).not.toThrow();
  });

  it("isolates each viewer — a removed one does not receive later events", () => {
    const a = makeClient();
    const b = makeClient();
    viewers.add(a);
    viewers.add(b);

    broadcast({ type: "state:remove", agentId: "first" });
    viewers.delete(a);
    broadcast({ type: "state:remove", agentId: "second" });

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/lib/__tests__/sse-broadcast.test.ts`
Expected: FAIL with "Cannot find module '../sse-broadcast'".

- [ ] **Step 3: Create `scripts/lib/sse-broadcast.ts`**

```ts
import type { ServerEvent } from "../../src/lib/types";

/** Anything we can write SSE frames to. Adapter shape for both real
 *  ReadableStream controllers and test doubles. */
export interface SSEClient {
  send(data: string): void;
}

// HMR-safe singleton — Next.js dev re-evaluates modules on file save, so the
// viewers set must live on globalThis to survive hot reloads.
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorViewers: Set<SSEClient> | undefined;
}

export const viewers: Set<SSEClient> = (globalThis.__agentMonitorViewers ??= new Set());

/** Fan out a server event as a stringified payload to every connected viewer. */
export function broadcast(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const viewer of viewers) {
    try {
      viewer.send(payload);
    } catch {
      // A disconnected viewer may throw on send. The route handler is
      // responsible for removing itself from `viewers` on stream abort, so
      // we just swallow here — by the next tick the set is consistent.
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/lib/__tests__/sse-broadcast.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sse-broadcast.ts scripts/lib/__tests__/sse-broadcast.test.ts
git commit -m "feat(sse): add sse-broadcast module with HMR-safe viewers set"
```

---

## Task 2: Refactor `agent-state.ts` to use globalThis singleton + sse-broadcast

**Files:**
- Modify: `scripts/lib/agent-state.ts`
- Modify: `scripts/ws-server.ts` (temporary adapter — deleted in Task 11)
- Test: `scripts/lib/__tests__/agent-state.hmr.test.ts` (new)

- [ ] **Step 1: Write the failing HMR-survival test**

Create `scripts/lib/__tests__/agent-state.hmr.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agents, viewers } from "../agent-state";

describe("agent-state HMR survival", () => {
  it("shares the same Map instance across module re-imports via globalThis", async () => {
    agents.set("hmr-test", {
      id: "hmr-test",
      agentType: "main",
      status: "running",
      task: "x",
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      contextWindow: 0,
      startTime: 0,
    });

    // Re-import — should NOT be a fresh map
    const reimport = await import("../agent-state?bust=1");
    expect(reimport.agents.has("hmr-test")).toBe(true);
    agents.delete("hmr-test");
  });

  it("viewers set is shared with sse-broadcast", async () => {
    const sse = await import("../sse-broadcast");
    expect(viewers).toBe(sse.viewers);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/lib/__tests__/agent-state.hmr.test.ts`
Expected: FAIL — `viewers` is currently `Set<WebSocket>` declared locally in `agent-state.ts`, not shared with sse-broadcast.

- [ ] **Step 3: Refactor `scripts/lib/agent-state.ts` — replace the top-of-file state block**

Replace lines 1–34 of `scripts/lib/agent-state.ts` (everything from the `WebSocket` import down through `export function getAgentFilePath` and `broadcast`) with:

```ts
import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  TeamState,
  ThinkingEffort,
  ToolCallEntry,
} from "../../src/lib/types";
import {
  STATUS_RUNNING_THRESHOLD_MS,
  MAX_TOOL_CALLS_PER_AGENT,
  INLINE_ARGS_MAX_KEYS,
  MAX_ARG_PREVIEW_LENGTH,
} from "./config";
import { viewers, broadcast, type SSEClient } from "./sse-broadcast";

// Re-exports so call sites that already import from agent-state keep working.
export { viewers, broadcast };
export type { SSEClient };

// ── HMR-safe singleton state ─────────────────────────
// Stashed on globalThis so Next.js dev hot-reloads do not wipe accumulated
// agent state, the polling loops' "started" flag, or in-flight viewer set.
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorState: {
    agents: Map<string, AgentState>;
    edges: EdgeState[];
    teams: Map<string, TeamState>;
    agentLastModified: Map<string, number>;
    removedAgentIds: Map<string, number>;
    agentFilePaths: Map<string, string>;
    started: boolean;
  } | undefined;
}

const store = (globalThis.__agentMonitorState ??= {
  agents: new Map<string, AgentState>(),
  edges: [] as EdgeState[],
  teams: new Map<string, TeamState>(),
  agentLastModified: new Map<string, number>(),
  removedAgentIds: new Map<string, number>(),
  agentFilePaths: new Map<string, string>(),
  started: false,
});

export const agents = store.agents;
export const edges = store.edges;
export const teams = store.teams;
export const agentLastModified = store.agentLastModified;
export const removedAgentIds = store.removedAgentIds;
export const agentFilePaths = store.agentFilePaths;

/** Get the JSONL file path for an agent */
export function getAgentFilePath(agentId: string): string | undefined {
  return agentFilePaths.get(agentId);
}

/** Internal: exposed for instrumentation.ts to consult/mutate the started flag */
export function _backgroundStarted(): boolean { return store.started; }
export function _markBackgroundStarted(): void { store.started = true; }
```

- [ ] **Step 4: Update `scripts/ws-server.ts` to push WebSocket as an SSEClient adapter**

Replace lines 28–35 of `scripts/ws-server.ts` (the local `broadcastToViewers` helper and the WS-typed viewer iteration) with a removal, and replace lines 74–75 (the `wss.on("connection", (ws) => { viewers.add(ws);` block start) with the adapter pattern.

Specifically, replace:

```ts
function broadcastToViewers(event: ServerEvent | { type: string; [key: string]: unknown }) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    if ((viewer as WebSocket).readyState === WebSocket.OPEN) {
      viewer.send(data);
    }
  }
}
```

with:

```ts
function broadcastToViewers(event: ServerEvent | { type: string; [key: string]: unknown }) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    try { viewer.send(data); } catch { /* viewer abort, will self-remove */ }
  }
}
```

And update the connection handler. Replace:

```ts
wss.on("connection", (ws) => {
  viewers.add(ws);
```

with:

```ts
wss.on("connection", (ws) => {
  const adapter: import("./lib/sse-broadcast").SSEClient = {
    send: (data: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
  };
  viewers.add(adapter);
```

And update the close/error handlers (lines 167–173) from `viewers.delete(ws)` to `viewers.delete(adapter)` (referencing the closure-captured adapter).

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including the new HMR-survival test.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/agent-state.ts scripts/lib/__tests__/agent-state.hmr.test.ts scripts/ws-server.ts
git commit -m "refactor(agent-state): move state onto globalThis, share viewers with sse-broadcast"
```

---

## Task 3: Extract `annotation-store.ts` from ws-server.ts

**Files:**
- Create: `scripts/lib/annotation-store.ts`
- Modify: `scripts/ws-server.ts`
- Test: `scripts/lib/__tests__/annotation-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/__tests__/annotation-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { annotations, sanitizeAnnotation } from "../annotation-store";
import { ANNOTATION_MAX_ENTRIES, ANNOTATION_MAX_TEXT_LENGTH } from "../config";

describe("annotation-store", () => {
  beforeEach(() => { annotations.clear(); });

  it("accepts a well-formed annotation", () => {
    const out = sanitizeAnnotation({
      id: "ann-abc123",
      targetId: "main-x",
      targetType: "agent",
      text: "hello",
      timestamp: 123,
    });
    expect(out).not.toBeNull();
    expect(out!.id).toBe("ann-abc123");
  });

  it("rejects an annotation with a malformed id", () => {
    expect(sanitizeAnnotation({ id: "bad", targetId: "x", targetType: "agent", text: "y", timestamp: 1 })).toBeNull();
  });

  it("rejects an annotation whose text exceeds the cap", () => {
    expect(sanitizeAnnotation({
      id: "ann-abc",
      targetId: "x",
      targetType: "agent",
      text: "x".repeat(ANNOTATION_MAX_TEXT_LENGTH + 1),
      timestamp: 1,
    })).toBeNull();
  });

  it("rejects an annotation with an unknown targetType", () => {
    expect(sanitizeAnnotation({
      id: "ann-abc", targetId: "x", targetType: "comment", text: "y", timestamp: 1,
    })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(sanitizeAnnotation(null)).toBeNull();
    expect(sanitizeAnnotation("string")).toBeNull();
    expect(sanitizeAnnotation(42)).toBeNull();
  });

  it("shares its Map across module re-imports", async () => {
    annotations.set("ann-hmr", {
      id: "ann-hmr", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });
    const reimport = await import("../annotation-store?bust=1");
    expect(reimport.annotations.has("ann-hmr")).toBe(true);
  });

  it("config caps are sane", () => {
    expect(ANNOTATION_MAX_ENTRIES).toBeGreaterThan(0);
    expect(ANNOTATION_MAX_TEXT_LENGTH).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/lib/__tests__/annotation-store.test.ts`
Expected: FAIL with "Cannot find module '../annotation-store'".

- [ ] **Step 3: Create `scripts/lib/annotation-store.ts`**

```ts
import type { Annotation } from "../../src/lib/types";
import {
  ANNOTATION_MAX_TEXT_LENGTH,
  ANNOTATION_ID_PATTERN,
} from "./config";

declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorAnnotations: Map<string, Annotation> | undefined;
}

export const annotations: Map<string, Annotation> = (
  globalThis.__agentMonitorAnnotations ??= new Map()
);

/** Validate and normalize untrusted annotation input.
 *  Returns null on any malformed field — callers must treat null as a 400. */
export function sanitizeAnnotation(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ANNOTATION_ID_PATTERN.test(o.id)) return null;
  if (typeof o.targetId !== "string" || o.targetId.length === 0 || o.targetId.length > 128) return null;
  if (o.targetType !== "agent" && o.targetType !== "edge") return null;
  if (typeof o.text !== "string" || o.text.length === 0 || o.text.length > ANNOTATION_MAX_TEXT_LENGTH) return null;
  if (typeof o.timestamp !== "number" || !Number.isFinite(o.timestamp)) return null;
  const author = typeof o.author === "string" && o.author.length <= 64 ? o.author : undefined;
  const x = typeof o.x === "number" && Number.isFinite(o.x) ? o.x : undefined;
  const y = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : undefined;
  return { id: o.id, targetId: o.targetId, targetType: o.targetType, text: o.text, timestamp: o.timestamp, author, x, y };
}
```

- [ ] **Step 4: Update `scripts/ws-server.ts` to import from the new module**

In `scripts/ws-server.ts`:

- Delete the `// ── Annotation storage` block (lines 25–26):
  ```ts
  // ── Annotation storage ───────────────────────────────
  const annotationStore = new Map<string, Annotation>();
  ```

- Delete the local `sanitizeAnnotation` function (lines 49–61).

- At the top of the file, add: `import { annotations, sanitizeAnnotation } from "./lib/annotation-store";`

- Find-and-replace `annotationStore` → `annotations` throughout the file (lines 87–119).

Remove the now-unused `Annotation` import if its only remaining use was the deleted store declaration.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including the 7 new annotation-store tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/annotation-store.ts scripts/lib/__tests__/annotation-store.test.ts scripts/ws-server.ts
git commit -m "refactor(annotations): extract annotation-store from ws-server"
```

---

## Task 4: Build `/api/logs/[agentId]` route

**Files:**
- Create: `src/app/api/logs/[agentId]/route.ts`
- Test: `src/app/api/logs/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/logs/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../../scripts/lib/log-reader", () => ({
  readAgentLog: vi.fn(),
}));

vi.mock("../../../../../scripts/lib/agent-state", () => ({
  getAgentFilePath: vi.fn(),
}));

import { GET } from "../[agentId]/route";
import { readAgentLog } from "../../../../../scripts/lib/log-reader";
import { getAgentFilePath } from "../../../../../scripts/lib/agent-state";

const mockReadAgentLog = vi.mocked(readAgentLog);
const mockGetAgentFilePath = vi.mocked(getAgentFilePath);

function makeRequest(): Request {
  return new Request("http://localhost/api/logs/x");
}

describe("/api/logs/[agentId] GET", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 200 with entries when the agent has a file path", async () => {
    mockGetAgentFilePath.mockReturnValue("/fake/path.jsonl");
    mockReadAgentLog.mockResolvedValue([
      { timestamp: 1, role: "user", content: "hi" },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "main-x" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].content).toBe("hi");
  });

  it("returns 404 when the agent has no file path", async () => {
    mockGetAgentFilePath.mockReturnValue(undefined);

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "ghost" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 500 when readAgentLog throws", async () => {
    mockGetAgentFilePath.mockReturnValue("/fake/path.jsonl");
    mockReadAgentLog.mockRejectedValue(new Error("disk full"));

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "x" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/disk full/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/logs/__tests__/route.test.ts`
Expected: FAIL with "Cannot find module '../[agentId]/route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/logs/[agentId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readAgentLog } from "../../../../../scripts/lib/log-reader";
import { getAgentFilePath } from "../../../../../scripts/lib/agent-state";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await params;
  const filePath = getAgentFilePath(agentId);
  if (!filePath) {
    return NextResponse.json(
      { error: "Agent not found or no log file available" },
      { status: 404 },
    );
  }
  try {
    const entries = await readAgentLog(filePath);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read log: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/logs/__tests__/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/logs/[agentId]/route.ts src/app/api/logs/__tests__/route.test.ts
git commit -m "feat(api): add GET /api/logs/[agentId] route"
```

---

## Task 5: Build `/api/annotations` POST route

**Files:**
- Create: `src/app/api/annotations/route.ts`
- Test: `src/app/api/annotations/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/annotations/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { viewers, type SSEClient } from "../../../../../scripts/lib/sse-broadcast";
import { ANNOTATION_MAX_ENTRIES } from "../../../../../scripts/lib/config";

import { POST } from "../route";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return { received, send(data: string) { received.push(data); } };
}

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/annotations POST", () => {
  beforeEach(() => {
    annotations.clear();
    viewers.clear();
  });

  it("creates a valid annotation, returns 201, and broadcasts annotation:update add", async () => {
    const client = makeClient();
    viewers.add(client);

    const res = await POST(postBody({
      id: "ann-abc123",
      targetId: "main-x",
      targetType: "agent",
      text: "hello",
      timestamp: 1700000000000,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.annotation.id).toBe("ann-abc123");
    expect(annotations.size).toBe(1);
    expect(client.received).toHaveLength(1);
    const broadcast = JSON.parse(client.received[0]);
    expect(broadcast.type).toBe("annotation:update");
    expect(broadcast.action).toBe("add");
    expect(broadcast.annotation.id).toBe("ann-abc123");
  });

  it("returns 400 on malformed input (bad id pattern)", async () => {
    const res = await POST(postBody({
      id: "bad", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 409 on duplicate id", async () => {
    annotations.set("ann-existing", {
      id: "ann-existing", targetId: "x", targetType: "agent", text: "old", timestamp: 1,
    });
    const res = await POST(postBody({
      id: "ann-existing", targetId: "x", targetType: "agent", text: "new", timestamp: 2,
    }));
    expect(res.status).toBe(409);
  });

  it("evicts oldest when over cap", async () => {
    for (let i = 0; i < ANNOTATION_MAX_ENTRIES; i++) {
      annotations.set(`ann-fill${i}`, {
        id: `ann-fill${i}`, targetId: "x", targetType: "agent", text: "y", timestamp: i,
      });
    }
    expect(annotations.size).toBe(ANNOTATION_MAX_ENTRIES);

    const res = await POST(postBody({
      id: "ann-newest", targetId: "x", targetType: "agent", text: "z", timestamp: 999999,
    }));
    expect(res.status).toBe(201);
    expect(annotations.size).toBe(ANNOTATION_MAX_ENTRIES);
    expect(annotations.has("ann-fill0")).toBe(false);
    expect(annotations.has("ann-newest")).toBe(true);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request("http://localhost/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/annotations/__tests__/route.test.ts`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/annotations/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  annotations,
  sanitizeAnnotation,
} from "../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../scripts/lib/sse-broadcast";
import { ANNOTATION_MAX_ENTRIES } from "../../../../scripts/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ann = sanitizeAnnotation(raw);
  if (!ann) {
    return NextResponse.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  if (annotations.has(ann.id)) {
    return NextResponse.json({ error: "Annotation id already exists" }, { status: 409 });
  }

  while (annotations.size >= ANNOTATION_MAX_ENTRIES) {
    const oldest = annotations.keys().next().value;
    if (oldest === undefined) break;
    annotations.delete(oldest);
  }

  annotations.set(ann.id, ann);
  broadcast({ type: "annotation:update", action: "add", annotation: ann });

  return NextResponse.json({ annotation: ann }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/annotations/__tests__/route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/annotations/route.ts src/app/api/annotations/__tests__/route.test.ts
git commit -m "feat(api): add POST /api/annotations route"
```

---

## Task 6: Build `/api/annotations/[id]` DELETE route

**Files:**
- Create: `src/app/api/annotations/[id]/route.ts`
- Test: `src/app/api/annotations/__tests__/delete.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/annotations/__tests__/delete.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { viewers, type SSEClient } from "../../../../../scripts/lib/sse-broadcast";
import { DELETE } from "../[id]/route";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return { received, send(data: string) { received.push(data); } };
}

describe("/api/annotations/[id] DELETE", () => {
  beforeEach(() => {
    annotations.clear();
    viewers.clear();
  });

  it("removes an existing annotation, returns 204, and broadcasts annotation:update remove", async () => {
    annotations.set("ann-keep", {
      id: "ann-keep", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });
    const client = makeClient();
    viewers.add(client);

    const res = await DELETE(
      new Request("http://localhost/api/annotations/ann-keep", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ann-keep" }) },
    );

    expect(res.status).toBe(204);
    expect(annotations.has("ann-keep")).toBe(false);
    expect(client.received).toHaveLength(1);
    const broadcast = JSON.parse(client.received[0]);
    expect(broadcast.type).toBe("annotation:update");
    expect(broadcast.action).toBe("remove");
    expect(broadcast.annotation.id).toBe("ann-keep");
  });

  it("returns 404 when the annotation does not exist", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/annotations/ghost", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/annotations/__tests__/delete.test.ts`
Expected: FAIL with "Cannot find module '../[id]/route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/annotations/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../../scripts/lib/sse-broadcast";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const existing = annotations.get(id);
  if (!existing) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
  annotations.delete(id);
  broadcast({ type: "annotation:update", action: "remove", annotation: existing });
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/annotations/__tests__/delete.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/annotations/[id]/route.ts src/app/api/annotations/__tests__/delete.test.ts
git commit -m "feat(api): add DELETE /api/annotations/[id] route"
```

---

## Task 7: Build `/api/stream` SSE route

**Files:**
- Create: `src/app/api/stream/route.ts`
- Test: `src/app/api/stream/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/stream/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { agents, edges, teams, viewers } from "../../../../../scripts/lib/agent-state";
import { annotations } from "../../../../../scripts/lib/annotation-store";
import { broadcast } from "../../../../../scripts/lib/sse-broadcast";
import { GET } from "../route";

async function readFrames(body: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = "";

  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith(":")) continue; // keepalive comment
      if (raw.startsWith("data: ")) frames.push(raw.slice("data: ".length));
    }
  }
  await reader.cancel();
  return frames;
}

describe("/api/stream GET (SSE)", () => {
  beforeEach(() => {
    agents.clear();
    edges.length = 0;
    teams.clear();
    annotations.clear();
    viewers.clear();
  });

  it("returns text/event-stream and sends state:sync as the first frame", async () => {
    agents.set("main-x", {
      id: "main-x", agentType: "main", status: "running", task: "t",
      toolCalls: [], inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0,
    });

    const res = GET(new Request("http://localhost/api/stream"));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-store|no-cache/);

    const [first] = await readFrames(res.body!, 1);
    const event = JSON.parse(first);
    expect(event.type).toBe("state:sync");
    expect(event.agents).toHaveLength(1);
    expect(event.agents[0].id).toBe("main-x");
  });

  it("delivers a broadcast() to the connected viewer as a data frame", async () => {
    const res = GET(new Request("http://localhost/api/stream"));
    // Read state:sync first to fully open the stream
    const pre = readFrames(res.body!, 2);

    // Fire after viewer is added (next tick — the start() runs sync but
    // microtasks settle here)
    queueMicrotask(() => {
      broadcast({ type: "state:remove", agentId: "main-x" });
    });

    const frames = await pre;
    const remove = frames.find((f) => JSON.parse(f).type === "state:remove");
    expect(remove).toBeDefined();
  });

  it("registers a viewer in the viewers set during the stream lifecycle", async () => {
    expect(viewers.size).toBe(0);
    const res = GET(new Request("http://localhost/api/stream"));
    // First frame ensures start() has executed and viewer is added
    await readFrames(res.body!, 1);
    expect(viewers.size).toBe(1);
    await res.body!.cancel();
    // Allow microtask queue to flush the abort handler
    await new Promise((r) => setTimeout(r, 0));
    expect(viewers.size).toBe(0);
  });

  it("sends annotation:sync after state:sync when annotations exist", async () => {
    annotations.set("ann-pre", {
      id: "ann-pre", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });

    const res = GET(new Request("http://localhost/api/stream"));
    const [first, second] = await readFrames(res.body!, 2);
    expect(JSON.parse(first).type).toBe("state:sync");
    expect(JSON.parse(second).type).toBe("annotation:sync");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/stream/__tests__/route.test.ts`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/stream/route.ts`:

```ts
import {
  agents,
  edges,
  teams,
  viewers,
} from "../../../../scripts/lib/agent-state";
import { annotations } from "../../../../scripts/lib/annotation-store";
import { PROTOCOL_VERSION, type ServerEvent } from "../../../../src/lib/types";
import type { SSEClient } from "../../../../scripts/lib/sse-broadcast";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

export function GET(_request: Request): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const client: SSEClient = {
        send(data: string) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
      };
      viewers.add(client);

      // Initial snapshot
      const syncEvent: ServerEvent = {
        type: "state:sync",
        agents: Array.from(agents.values()),
        edges: [...edges],
        teams: Array.from(teams.values()),
        protocolVersion: PROTOCOL_VERSION,
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(syncEvent)}\n\n`));

      if (annotations.size > 0) {
        const annSync: ServerEvent = {
          type: "annotation:sync",
          annotations: Array.from(annotations.values()),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(annSync)}\n\n`));
      }

      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
        catch { /* stream closed; cancel() removed us */ }
      }, KEEPALIVE_MS);

      // Stash for cancel(); attach to client so we keep one ref point
      (client as SSEClient & { _keepalive: NodeJS.Timeout })._keepalive = keepalive;
      (client as SSEClient & { _controller: ReadableStreamDefaultController }).
        _controller = controller;
    },
    cancel() {
      // Cancel sweeps the viewers set: find by controller identity is overkill
      // since each connection makes its own client object. We accept O(n) here
      // because n is at most a handful of dashboard tabs.
      for (const v of viewers) {
        const wrapped = v as SSEClient & { _keepalive?: NodeJS.Timeout; _controller?: ReadableStreamDefaultController };
        if (wrapped._controller && (wrapped._controller as unknown as { desiredSize: number | null }).desiredSize === null) {
          if (wrapped._keepalive) clearInterval(wrapped._keepalive);
          viewers.delete(v);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
```

Note on the cancel() approach: storing `_keepalive` and `_controller` on the client object lets cancel() find and clean up its own resources. The `desiredSize === null` check identifies the controller that has been canceled. This is verbose but avoids a closure ref leak.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/stream/__tests__/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stream/route.ts src/app/api/stream/__tests__/route.test.ts
git commit -m "feat(api): add GET /api/stream SSE endpoint"
```

---

## Task 8: Build `useEventStream` hook

**Files:**
- Create: `src/hooks/useEventStream.ts`
- Modify: `src/lib/config.ts` (add `STREAM_BATCH_*` constants — keeps `WS_BATCH_*` for now, deleted in Task 13)
- Test: `src/hooks/__tests__/useEventStream.test.tsx`

- [ ] **Step 1: Add `STREAM_BATCH_*` constants to `src/lib/config.ts`**

Add to `src/lib/config.ts` (right after the existing `WS_BATCH_*` declarations, line 27):

```ts
export const STREAM_BATCH_INTERVAL_MS = 16; // Flush buffered state:update events ~1 frame
export const STREAM_BATCH_MAX_SIZE = 50;    // Force-flush at this many buffered events
```

- [ ] **Step 2: Write the failing test**

Create `src/hooks/__tests__/useEventStream.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEventStream } from "../useEventStream";
import { useAgentStore } from "@/lib/store";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  close() { this.closed = true; }
}

describe("useEventStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    useAgentStore.setState({ agents: new Map(), edges: [], teams: new Map(), connected: false });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("connects to /api/stream and sets connected=true on open", async () => {
    renderHook(() => useEventStream());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/stream");
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });
    expect(useAgentStore.getState().connected).toBe(true);
  });

  it("handles state:sync by populating agents/edges/teams", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "state:sync",
        agents: [{ id: "a", agentType: "main", status: "running", task: "t",
          toolCalls: [], inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        edges: [],
        teams: [],
        protocolVersion: 1,
      });
    });
    expect(useAgentStore.getState().agents.has("a")).toBe(true);
  });

  it("buffers state:update events and flushes them", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    // Seed an agent so the agent:tool_call update has something to land on
    act(() => {
      useAgentStore.getState().syncState(
        [{ id: "main-x", agentType: "main", status: "running", task: "t",
           toolCalls: [], inputTokens: 0, outputTokens: 0,
           cacheReadTokens: 0, cacheCreateTokens: 0, contextWindow: 0, startTime: 0 }],
        [], [],
      );
    });

    act(() => {
      es.emit({
        type: "state:update",
        event: { type: "agent:tool_call", agentId: "main-x", tool: "Read" },
        timestamp: 1700000000000,
      });
    });
    // Wait for the 16ms batch flush
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    const agent = useAgentStore.getState().agents.get("main-x");
    expect(agent?.toolCalls.some((tc) => tc.tool === "Read")).toBe(true);
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it("handles annotation:update add by writing to the store", async () => {
    renderHook(() => useEventStream());
    const es = MockEventSource.instances[0];
    await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); });

    act(() => {
      es.emit({
        type: "annotation:update",
        action: "add",
        annotation: { id: "ann-x", targetId: "main", targetType: "agent", text: "hi", timestamp: 1 },
      });
    });
    expect(useAgentStore.getState().annotations.has("ann-x")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useEventStream.test.tsx`
Expected: FAIL with "Cannot find module '../useEventStream'".

- [ ] **Step 4: Implement the hook**

Create `src/hooks/useEventStream.ts`:

```ts
"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { STREAM_BATCH_INTERVAL_MS, STREAM_BATCH_MAX_SIZE } from "@/lib/config";
import { PROTOCOL_VERSION } from "@/lib/types";
import { isValidServerEvent } from "@/lib/validation";

/**
 * Subscribe to the server's live state stream via SSE.
 *
 * Replaces the WebSocket transport. EventSource handles reconnect natively;
 * we only own the per-event dispatch into the Zustand store, with a small
 * batch buffer for state:update events to coalesce render churn.
 */
export function useEventStream() {
  useEffect(() => {
    let destroyed = false;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let eventBuffer: Array<{ event: import("@/lib/types").AgentEvent; timestamp: number }> = [];
    let protocolWarned = false;

    function flushEventBuffer() {
      if (eventBuffer.length === 0) return;
      const batch = eventBuffer;
      eventBuffer = [];
      batchTimer = null;
      const { handleEvent } = useAgentStore.getState();
      for (const { event, timestamp } of batch) {
        handleEvent(event, timestamp);
      }
    }

    function enqueueEvent(event: import("@/lib/types").AgentEvent, timestamp: number) {
      eventBuffer.push({ event, timestamp });
      if (eventBuffer.length >= STREAM_BATCH_MAX_SIZE) {
        if (batchTimer !== null) { clearTimeout(batchTimer); batchTimer = null; }
        flushEventBuffer();
      } else if (batchTimer === null) {
        batchTimer = setTimeout(flushEventBuffer, STREAM_BATCH_INTERVAL_MS);
      }
    }

    const es = new EventSource("/api/stream");

    es.onopen = () => {
      if (destroyed) return;
      useAgentStore.getState().setConnected(true);
    };

    es.onerror = () => {
      // EventSource auto-reconnects; just reflect the transient disconnect.
      useAgentStore.getState().setConnected(false);
    };

    es.onmessage = (msg) => {
      if (destroyed) return;
      let data: unknown;
      try { data = JSON.parse(msg.data); }
      catch { return; }

      if (!isValidServerEvent(data)) return;
      const event = data;
      const store = useAgentStore.getState();
      const replayActive = store.replay.active;

      switch (event.type) {
        case "state:sync":
          if (!protocolWarned && event.protocolVersion !== PROTOCOL_VERSION) {
            console.warn(
              `Stream protocol version mismatch: server=${event.protocolVersion ?? "unset"}, client=${PROTOCOL_VERSION}. Continuing.`,
            );
            protocolWarned = true;
          }
          if (!replayActive) store.syncState(event.agents, event.edges, event.teams);
          break;
        case "state:update":
          if (!replayActive) enqueueEvent(event.event, event.timestamp);
          break;
        case "state:remove":
          if (!replayActive) store.removeAgent(event.agentId);
          break;
        case "log:response":
          store.setLogEntries(event.agentId, event.entries);
          break;
        case "log:error":
          store.setLogLoading(event.agentId, false);
          console.warn("Log fetch error for agent", event.agentId, ":", event.error);
          break;
        case "annotation:sync":
          for (const ann of event.annotations) store.addAnnotation(ann);
          break;
        case "annotation:update":
          if (event.action === "add") store.addAnnotation(event.annotation);
          else store.removeAnnotation(event.annotation.id);
          break;
      }
    };

    return () => {
      destroyed = true;
      if (batchTimer !== null) clearTimeout(batchTimer);
      flushEventBuffer();
      es.close();
      useAgentStore.getState().setConnected(false);
    };
  }, []);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useEventStream.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useEventStream.ts src/hooks/__tests__/useEventStream.test.tsx src/lib/config.ts
git commit -m "feat(client): add useEventStream hook (SSE replacement for useWebSocket)"
```

---

## Task 9: Create `src/instrumentation.ts`

**Files:**
- Create: `src/instrumentation.ts`
- Modify: `scripts/lib/agent-state.ts` (add `startBackgroundTasks` export)

- [ ] **Step 1: Add `startBackgroundTasks` to `scripts/lib/agent-state.ts`**

Append to `scripts/lib/agent-state.ts` (at the bottom of the file, after the existing `processEntry` function):

```ts
// ── Background tasks ─────────────────────────────────
// Polling cadence and usage cache refresh were previously owned by the
// stand-alone ws-server process. After the SSE migration they run inside
// the Next.js process, started exactly once by src/instrumentation.ts.

import * as path from "node:path";
import * as os from "node:os";

export async function startBackgroundTasks(): Promise<void> {
  if (_backgroundStarted()) return;
  _markBackgroundStarted();

  const { discoverActiveSessions } = await import("./discovery");
  const { POLL_INTERVAL_MS, USAGE_REFRESH_INTERVAL_MS, USAGE_REFRESH_THRESHOLD_MS } = await import("./config");
  const { readCacheMtime, triggerCcstatuslineRefresh } = await import("./ccstatusline");
  const { loadWebhookConfig } = await import("./webhooks");

  const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

  loadWebhookConfig();

  console.log(`[bg] Agent Monitor background tasks starting`);
  console.log(`[bg] Watching: ${PROJECTS_DIR}`);
  console.log(`[bg] Poll interval: ${POLL_INTERVAL_MS}ms`);

  async function pollLoop(): Promise<void> {
    try {
      await discoverActiveSessions(PROJECTS_DIR);
    } catch (err) {
      console.warn("[bg poll] discovery failed:", err);
    } finally {
      setTimeout(pollLoop, POLL_INTERVAL_MS);
    }
  }

  async function usagePollLoop(): Promise<void> {
    try {
      const mtime = readCacheMtime();
      if (mtime === null || Date.now() - mtime > USAGE_REFRESH_THRESHOLD_MS) {
        triggerCcstatuslineRefresh();
      }
    } catch (err) {
      console.warn("[bg usage] refresh failed:", err);
    } finally {
      setTimeout(usagePollLoop, USAGE_REFRESH_INTERVAL_MS);
    }
  }

  discoverActiveSessions(PROJECTS_DIR).then(() => {
    console.log(`[bg] Found ${agents.size} active agent(s)`);
    pollLoop();
  }).catch((err) => {
    console.warn("[bg startup] initial discovery failed:", err);
    pollLoop();
  });

  usagePollLoop();
}
```

- [ ] **Step 2: Create `src/instrumentation.ts`**

```ts
/**
 * Next.js instrumentation hook — runs once when the Next.js server boots
 * (both `next dev` and `next start`). We use it to kick off the JSONL
 * polling loop and the ccstatusline usage cache refresh.
 *
 * Located at src/instrumentation.ts (sibling to src/app/) per the
 * Next.js convention when using the src/ layout.
 */
export async function register(): Promise<void> {
  // The state singleton uses Node-only APIs (fs, path). Guard so the edge
  // runtime instance — if Next ever spins one up — does not import them.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackgroundTasks } = await import("../scripts/lib/agent-state");
  await startBackgroundTasks();
}
```

- [ ] **Step 3: Verify instrumentation runs by adding a smoke test marker**

Add to the top of `register()` in `src/instrumentation.ts`:

```ts
console.log("[instrumentation] register() called");
```

Run: `npm run dev` (let it boot for ~3 seconds, then Ctrl+C).
Expected: Console output contains `[instrumentation] register() called` AND `[bg] Agent Monitor background tasks starting`.

If the log doesn't appear, check `next.config.ts` — older Next.js required `experimental.instrumentationHook: true`, but Next.js 15+ enables it by default. Verify with: `cat next.config.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/instrumentation.ts scripts/lib/agent-state.ts
git commit -m "feat(server): add instrumentation hook to start background tasks in-process"
```

---

## Task 10: Cutover — switch Dashboard + AgentDetail + AnnotationOverlay to new APIs

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/AgentDetail.tsx`
- Modify: `src/components/AnnotationOverlay.tsx`
- Modify: `src/components/__tests__/Dashboard.test.tsx`

- [ ] **Step 1: Swap the hook in `src/components/Dashboard.tsx`**

Replace line 4:
```ts
import { useWebSocket } from "@/hooks/useWebSocket";
```
with:
```ts
import { useEventStream } from "@/hooks/useEventStream";
```

Replace line 32:
```ts
  useWebSocket();
```
with:
```ts
  useEventStream();
```

- [ ] **Step 2: Update `src/components/AgentDetail.tsx`**

Replace line 11:
```ts
import { sendWsMessage } from "@/hooks/useWebSocket";
```
Delete that line entirely (no replacement; we'll use `fetch` directly).

Replace line 31, currently:
```ts
      sendWsMessage({ type: "log:request", agentId: agent.id });
```
with:
```ts
      void (async () => {
        try {
          const res = await fetch(`/api/logs/${encodeURIComponent(agent.id)}`);
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({ error: res.statusText }));
            useAgentStore.getState().setLogLoading(agent.id, false);
            console.warn("Log fetch failed:", error);
            return;
          }
          const body = await res.json();
          useAgentStore.getState().setLogEntries(agent.id, body.entries);
        } catch (err) {
          useAgentStore.getState().setLogLoading(agent.id, false);
          console.warn("Log fetch threw:", err);
        }
      })();
```

The `useAgentStore` import already exists in `AgentDetail.tsx` — verify with `grep useAgentStore src/components/AgentDetail.tsx`. If absent, add `import { useAgentStore } from "@/lib/store";` near the other imports.

- [ ] **Step 3: Update `src/components/AnnotationOverlay.tsx`**

Replace line 5:
```ts
import { sendWsMessage } from "@/hooks/useWebSocket";
```
Delete that line (no replacement).

Replace the `handleAdd` body (lines 20–35) with:

```ts
  function handleAdd() {
    const text = newText.trim();
    if (!text) return;

    const annotation: Annotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      targetId: agentId,
      targetType: "agent",
      text,
      author: CURRENT_USER,
      timestamp: Date.now(),
    };

    void (async () => {
      try {
        const res = await fetch("/api/annotations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(annotation),
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: res.statusText }));
          console.warn("Annotation add failed:", error);
        }
      } catch (err) {
        console.warn("Annotation add threw:", err);
      }
    })();
    setNewText("");
  }
```

Replace the `handleRemove` body (lines 37–39) with:

```ts
  function handleRemove(id: string) {
    void (async () => {
      try {
        const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          console.warn("Annotation remove failed:", res.statusText);
        }
      } catch (err) {
        console.warn("Annotation remove threw:", err);
      }
    })();
  }
```

- [ ] **Step 4: Update `src/components/__tests__/Dashboard.test.tsx`**

Run: `grep -n "useWebSocket\|sendWsMessage" src/components/__tests__/Dashboard.test.tsx`

Replace every mock of `useWebSocket` with `useEventStream`. Specifically, the existing `vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: vi.fn(), sendWsMessage: vi.fn() }))` (or similar) becomes:

```ts
vi.mock("@/hooks/useEventStream", () => ({ useEventStream: vi.fn() }));
```

The `sendWsMessage` mock entry is dropped — no replacement needed since `AgentDetail.tsx` and `AnnotationOverlay.tsx` no longer import it.

If the Dashboard test references `sendWsMessage` directly (asserting it was called with specific args), those assertions must be updated to spy on `fetch` instead:

```ts
const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
  new Response(JSON.stringify({ entries: [] }), { status: 200 }),
);
// ... assert fetchSpy.mock.calls[0][0] === "/api/logs/main-x"
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass. Some Dashboard tests may need adjustment if they spied on `sendWsMessage` — fix inline.

- [ ] **Step 6: Smoke test in browser**

Note: this step requires the OLD ws-server process to NOT be running (it would still bind port 4001 but the dashboard no longer connects there).

Run: `npm run dev`
Open: `http://localhost:4000`
Verify:
1. Dashboard loads with no console errors.
2. Network panel shows `GET /api/stream` with `text/event-stream` response.
3. If there are active Claude Code sessions, agents appear in the topology.
4. Clicking an agent opens the log viewer with entries.
5. Adding an annotation works; removing works; both update without reload.

Kill the dev server (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add src/components/Dashboard.tsx src/components/AgentDetail.tsx src/components/AnnotationOverlay.tsx src/components/__tests__/Dashboard.test.tsx
git commit -m "feat(client): cut Dashboard, AgentDetail, AnnotationOverlay over to SSE + HTTP routes"
```

---

## Task 11: Delete ws-server, useWebSocket, and the ws-server script

**Files:**
- Delete: `scripts/ws-server.ts`
- Delete: `src/hooks/useWebSocket.ts`
- Modify: `package.json` (remove `ws-server` script)

- [ ] **Step 1: Verify nothing imports from the soon-to-be-deleted files**

Run: `grep -rn "from \"@/hooks/useWebSocket\"\|from \"./useWebSocket\"\|scripts/ws-server" src/ scripts/ 2>/dev/null | grep -v __tests__`

Expected: No matches in production code. (The `scripts/lib/agent-state.ts` no longer imports `WebSocket` — confirmed in Task 2.)

If matches appear: stop and fix them before deleting. Common forgotten spots: `src/components/AgentDetail.tsx`, `src/components/AnnotationOverlay.tsx` (handled in Task 10). Look for any test file outside of `useWebSocket`'s own __tests__ that might still mock it.

- [ ] **Step 2: Delete the files**

```bash
rm scripts/ws-server.ts
rm src/hooks/useWebSocket.ts
# Tests for useWebSocket (if any):
rm -f src/hooks/__tests__/useWebSocket.test.tsx
```

- [ ] **Step 3: Remove the `ws-server` npm script**

Edit `package.json`. Remove the line:

```json
    "ws-server": "tsx scripts/ws-server.ts",
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: No type errors.

- [ ] **Step 6: Browser smoke test**

Run: `npm run dev`
Open: `http://localhost:4000`
Verify the dashboard still works end-to-end without the WS server.
Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: delete ws-server and useWebSocket — SSE replaces WS"
```

---

## Task 12: Delete `ClientEvent` and `pong` from types and validation

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/__tests__/validation.extra.test.ts`

- [ ] **Step 1: Delete `ClientEvent` and `pong` from `src/lib/types.ts`**

In `src/lib/types.ts`:

Delete the entire `ClientEvent` union (around lines 213–218):
```ts
// ── Client → Server Events ────────────────────────────
export type ClientEvent =
  | { type: "log:request"; agentId: string }
  | { type: "annotation:add"; annotation: Annotation }
  | { type: "annotation:remove"; annotationId: string }
  | { type: "ping" };
```

In the `ServerEvent` union (lines 96–104), delete the line:
```ts
  | { type: "pong" };
```

Make sure the preceding `| { type: "annotation:update"; ... }` line still ends with `;` after the delete.

Also update the doc comment at the top of the file (lines 17–18) to remove the heartbeat reference, since heartbeat is now SSE-comment-based, not protocol-level:

Replace:
```ts
 * Heartbeat: client sends `{type:"ping"}`, server replies `{type:"pong"}`.
 * Both are typed members of the protocol (added in v1).
 */
```
with:
```ts
 * Heartbeat: handled at the SSE transport layer via `: keepalive\n\n`
 * comments every 15s. No protocol-level ping/pong messages.
 */
```

- [ ] **Step 2: Delete `isValidClientEvent` and the `pong` case from `src/lib/validation.ts`**

In `src/lib/validation.ts`:

Update the import on line 1 to drop `ClientEvent`:
```ts
import type { AgentEvent, ServerEvent, AgentStatus, AgentType } from "./types";
```

Delete the `pong` case from `isValidServerEvent` (find the line `case "pong": return true;` and remove the case label and its return line).

Delete the entire `export function isValidClientEvent(...)` function and any helpers used only by it.

- [ ] **Step 3: Delete the `isValidClientEvent` tests**

Edit `src/lib/__tests__/validation.extra.test.ts`. Delete every `describe`/`it` block that calls `isValidClientEvent`. Keep blocks that call `isValidServerEvent`.

Update the file header comment (lines 4–6) to remove the `isValidClientEvent baseline` bullet.

If after the deletions an import of `isValidClientEvent` is left over, remove it from the test file's imports.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: No type errors. If any "Type 'pong' is not assignable" errors appear, find the corresponding code in the client hook (should not exist after Task 8 — the `useEventStream` switch statement does not handle `pong`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/validation.ts src/lib/__tests__/validation.extra.test.ts
git commit -m "refactor(types): remove ClientEvent union and pong ServerEvent variant"
```

---

## Task 13: Clean up config — remove WS-only constants

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `scripts/lib/config.ts`

- [ ] **Step 1: Clean up `src/lib/config.ts`**

Delete the entire block at the top of `src/lib/config.ts` (lines 1–26 — everything from the file header comment through `WS_BATCH_MAX_SIZE`):

```ts
// ── Client-side configuration ─────────────────────────

/** WebSocket server port (matches WS_PORT in scripts/lib/config.ts). */
const WS_PORT = 4001;

/** Build-time override. If set, getWsUrl() returns this verbatim ... */
const WS_URL_ENV = process.env.NEXT_PUBLIC_WS_URL;

/** SSR fallback — used when window is unavailable ... */
const WS_URL_SSR_FALLBACK = `ws://localhost:${WS_PORT}`;

/** Returns the WebSocket URL to connect to. ... */
export function getWsUrl(): string {
  // ...
}

export const WS_RECONNECT_DELAY_MS = 2000;
export const WS_RECONNECT_MAX_DELAY_MS = 30000;
export const WS_BATCH_INTERVAL_MS = 16;
export const WS_BATCH_MAX_SIZE = 50;
```

Replace with a short header explaining the file now starts with client-side display constants only:

```ts
// ── Client-side configuration ─────────────────────────
// Live state stream is consumed via SSE (`/api/stream`); see
// useEventStream.ts. STREAM_BATCH_* constants below tune the client-side
// event-buffer flush cadence used to coalesce render churn.
```

(The `STREAM_BATCH_*` constants from Task 8 remain. Everything else in this file — GRAPH, HEATMAP, COST_*, METRIC_*, REPLAY_*, IDLE_TIMEOUT_MS, etc. — stays unchanged.)

- [ ] **Step 2: Clean up `scripts/lib/config.ts`**

Delete the block at the top of `scripts/lib/config.ts` (lines 1–28):

```ts
export const WS_PORT = Number(process.env.WS_PORT) || 4001;
// ... down through the close of isAllowedOrigin
```

Keep `POLL_INTERVAL_MS` (it's referenced by the polling loop in `startBackgroundTasks`).

Replace the deleted region with:

```ts
// ── Server-side configuration ─────────────────────────

export const POLL_INTERVAL_MS = 1500;
```

(Everything from `ANNOTATION_MAX_ENTRIES` onward stays unchanged.)

- [ ] **Step 3: Find any stale references**

Run: `grep -rn "WS_PORT\|getWsUrl\|WS_RECONNECT\|WS_BATCH\|isAllowedOrigin\|WS_ALLOWED_ORIGINS" src/ scripts/ 2>/dev/null`

Expected: No matches in production code or tests.

If matches appear: each is either a stale import that needs deletion or a stale code path that wasn't caught earlier. Fix inline.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts scripts/lib/config.ts
git commit -m "chore(config): remove WS-only constants and helpers from config files"
```

---

## Task 14: Remove `ws` and `@types/ws` from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit `package.json`**

In `package.json`:

In `dependencies`, delete the line:
```json
    "ws": "^8.20.0",
```

In `devDependencies`, delete the line:
```json
    "@types/ws": "^8.18.1",
```

- [ ] **Step 2: Update lockfile**

Run: `npm install`
Expected: `package-lock.json` updates to drop `ws` and `@types/ws`.

- [ ] **Step 3: Verify no `ws` imports remain**

Run: `grep -rn "from \"ws\"\|require(\"ws\")\|@types/ws" src/ scripts/ 2>/dev/null`

Expected: No matches.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): remove ws and @types/ws — replaced by native SSE"
```

---

## Task 15: Rewrite `scripts/mock-agents.ts` to seed JSONL files

**Files:**
- Rewrite: `scripts/mock-agents.ts`

- [ ] **Step 1: Inspect the current file to keep the simulation structure**

Run: `wc -l scripts/mock-agents.ts && head -3 scripts/mock-agents.ts`
Expected output indicates the existing file size (~12 KB). We will keep the high-level simulation flow (register main, register sub-agents, fire tool calls, complete) but replace the WS-send mechanism with JSONL writes.

- [ ] **Step 2: Replace the file with the JSONL-seeding version**

Replace the entire contents of `scripts/mock-agents.ts` with:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/** Mock-agents seeds JSONL files into PROJECTS_DIR so the discovery poller
 *  picks them up via the real code path. */
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const MOCK_PREFIX = "-mock-agents-demo";
const MOCK_DIR = path.join(PROJECTS_DIR, MOCK_PREFIX);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randomId() { return Math.random().toString(36).slice(2, 10); }

interface JsonlLine {
  timestamp: string;
  message: {
    role: "user" | "assistant" | "system";
    model?: string;
    content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  meta?: { agentType?: string };
}

async function appendLine(file: string, line: JsonlLine): Promise<void> {
  await fs.appendFile(file, JSON.stringify(line) + "\n", "utf8");
}

async function writeFirstLine(file: string, slug: string, agentType: string): Promise<void> {
  const first: JsonlLine = {
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: `Mock session: ${slug}` }] },
    meta: { agentType },
  };
  await fs.writeFile(file, JSON.stringify(first) + "\n", "utf8");
}

async function cleanupMockDir(): Promise<void> {
  try { await fs.rm(MOCK_DIR, { recursive: true, force: true }); }
  catch (err) { console.warn("[mock] cleanup failed:", err); }
}

async function runSimulation(): Promise<void> {
  await cleanupMockDir();
  await fs.mkdir(MOCK_DIR, { recursive: true });
  console.log(`[mock] Seeding into ${MOCK_DIR}`);

  const mainSession = randomId();
  const mainFile = path.join(MOCK_DIR, `${mainSession}.jsonl`);
  await writeFirstLine(mainFile, mainSession, "main");
  console.log(`[mock] Main session started: ${mainSession}`);

  // Simulate tool calls on the main session
  for (const tool of ["Read", "Grep", "Edit"]) {
    await sleep(800);
    await appendLine(mainFile, {
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "tool_use", name: tool, input: { path: `/fake/${tool.toLowerCase()}.ts` } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    console.log(`[mock] tool_call ${tool} on main`);
  }

  // Spawn a sub-agent (another JSONL file in the same mock project dir)
  const subSession = randomId();
  const subFile = path.join(MOCK_DIR, `${subSession}.jsonl`);
  await writeFirstLine(subFile, subSession, "explore");
  console.log(`[mock] Sub-agent started: ${subSession}`);

  for (const tool of ["Read", "Bash"]) {
    await sleep(600);
    await appendLine(subFile, {
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "tool_use", name: tool, input: { command: "ls" } }],
        usage: { input_tokens: 80, output_tokens: 30 },
      },
    });
    console.log(`[mock] tool_call ${tool} on sub`);
  }

  // Hold the mock open so the topology has time to render
  console.log("[mock] Simulation complete. Press Ctrl+C to clean up and exit.");
  await new Promise(() => { /* hang forever */ });
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[mock] Cleaning up mock dir…");
  await cleanupMockDir();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

runSimulation().catch((err) => {
  console.error("[mock] Failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke test**

Open two terminals.

Terminal A:
```bash
npm run dev
```
Wait for `[bg] Agent Monitor background tasks starting`.

Terminal B:
```bash
npm run mock-agents
```
Expected output:
```
[mock] Seeding into /Users/.../.claude/projects/-mock-agents-demo
[mock] Main session started: <id>
[mock] tool_call Read on main
[mock] tool_call Grep on main
[mock] tool_call Edit on main
[mock] Sub-agent started: <id>
[mock] tool_call Read on sub
[mock] tool_call Bash on sub
[mock] Simulation complete...
```

In the browser at `http://localhost:4000`: a `-mock-agents-demo` session should appear in the topology within ~1.5s (next discovery poll).

Press Ctrl+C in Terminal B. Verify the mock dir is cleaned up:
```bash
ls ~/.claude/projects/-mock-agents-demo 2>&1 | head -1
```
Expected: `No such file or directory`.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add scripts/mock-agents.ts
git commit -m "feat(mock-agents): seed JSONL files into PROJECTS_DIR via real discovery path"
```

---

## Task 16: Final verification — acceptance criteria check

**Files:** None modified (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: All tests pass. Total count should be within ±10 of the pre-migration baseline of 557 (likely 562–567 after the new SSE/route tests minus the deleted WS-only tests).

Record the number: `npx vitest run 2>&1 | tail -5`

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: No type errors.

- [ ] **Step 3: Grep for residual WS references in production code**

Run: `grep -rnE "WebSocket|ws://|WS_PORT|sendWsMessage|useWebSocket|isValidClientEvent" src/ scripts/ 2>/dev/null | grep -v __tests__`

Expected: No matches. (Test files may legitimately contain these strings as legacy fixtures; production code must be clean.)

If matches appear, decide per-line: stale comment (delete), stale code (delete), or legitimate mention in a doc comment (keep but note).

- [ ] **Step 4: Verify `package.json` is clean**

Run: `grep -E '"ws"|"@types/ws"|"ws-server":' package.json`
Expected: No matches.

- [ ] **Step 5: Single-process boot**

Run: `npm run dev`
Verify console:
- `[instrumentation] register() called`
- `[bg] Agent Monitor background tasks starting`
- `Local:        http://localhost:4000`
- No `Error: Port 4001` or any reference to port 4001.

Open `http://localhost:4000`.

Verify:
1. Dashboard loads.
2. DevTools Network panel: a single `GET /api/stream` request with response type `text/event-stream`. No `ws://` connection.
3. If real Claude Code sessions are active: agents appear in the topology.
4. Click an agent → log viewer populates (verifies `GET /api/logs/[agentId]`).
5. Add an annotation → it appears immediately. Open the same URL in a second browser tab → annotation visible. Remove it → vanishes from both tabs (verifies `POST` + `DELETE` + SSE rebroadcast).

- [ ] **Step 6: LAN/mobile smoke**

With `npm run dev` still running, identify the LAN IP:
```bash
ipconfig getifaddr en0  # macOS Wi-Fi
```

From a phone or second device on the same network, open `http://<lan-ip>:4000`.

Verify:
1. Dashboard loads.
2. Topology renders.
3. No disconnect within 30 seconds (the keepalive should hold the connection open). Sleep the phone for 60 seconds, wake it, return to the tab: connection should reconnect automatically and re-sync from the next `state:sync`.

- [ ] **Step 7: HMR survival**

With `npm run dev` running, edit a non-server file (e.g., add a comment to `src/components/AgentList.tsx`) and save. Wait for the HMR reload notification in the browser.

Verify:
1. The dashboard auto-reloads.
2. Agent count and topology re-sync immediately.
3. Background task console log does NOT print `[bg] Agent Monitor background tasks starting` again (only the first boot should).

Stop the dev server.

- [ ] **Step 8: Final commit (only if any cleanups were needed above)**

If steps 1–7 surfaced anything to clean up:
```bash
git add -A
git commit -m "chore: final SSE migration cleanups"
```

Otherwise the migration is complete on the existing commit history.

- [ ] **Step 9: Summary**

Report against the spec's Acceptance Criteria section:

```
SSE migration acceptance:
1. ✅ npm run dev starts a single Next.js process on 4000; no ws-server.
2. ✅ Dashboard loads at http://localhost:4000; topology populates.
3. ✅ EventSource reconnect verified by 30s server pause.
4. ✅ Log viewer populated via GET /api/logs/[agentId].
5. ✅ Annotation add/remove via POST/DELETE + SSE rebroadcast.
6. ✅ npm run test passes (N tests, ±10 of baseline 557).
7. ✅ npm run type-check passes.
8. ✅ Phone at http://<lan-ip>:4000 loads dashboard, receives live updates.
9. ✅ grep for WebSocket/ws://_WS_PORT in production code returns no hits;
       package.json no longer lists ws or @types/ws.
```

---

## Self-Review (run after writing the plan)

### 1. Spec coverage

- [x] **Single port / single process** → Tasks 7, 9, 11 (SSE endpoint, instrumentation hook, ws-server deletion).
- [x] **Preserve log viewer** → Task 4 (`/api/logs/[agentId]`) + Task 10 (AgentDetail rewire).
- [x] **Preserve annotations** → Tasks 5–6 (POST/DELETE) + Task 10 (AnnotationOverlay rewire).
- [x] **Snapshot-on-connect semantics** → Task 7 (route sends `state:sync` then `annotation:sync` on connect).
- [x] **15s keepalive** → Task 7 (KEEPALIVE_MS constant + setInterval).
- [x] **HMR-safe singleton** → Tasks 1–3 + Task 2 HMR test.
- [x] **`instrumentation.ts` at `src/instrumentation.ts`** → Task 9.
- [x] **Remove `ClientEvent`/`pong`** → Task 12.
- [x] **Drop `getWsUrl`, `WS_RECONNECT_*`, `WS_PORT`** → Task 13.
- [x] **Remove `ws` dependency** → Task 14.
- [x] **mock-agents rewrite** → Task 15.
- [x] **All migration acceptance criteria** → Task 16.

### 2. Placeholder scan

None of the disallowed patterns appear: no "TBD", no "implement later", no "similar to Task N", no "add appropriate error handling" without code. Every code-changing step shows the code.

### 3. Type consistency

- `SSEClient` interface declared once in Task 1, referenced consistently in Tasks 2, 3, 5, 6, 7. Signature is stable: `{ send(data: string): void }`.
- `broadcast(event: ServerEvent)` signature consistent across all callers.
- `viewers: Set<SSEClient>` — single declaration, re-exported through `agent-state.ts`.
- `startBackgroundTasks(): Promise<void>` — declared in Task 9, called from `src/instrumentation.ts`.
- `STREAM_BATCH_INTERVAL_MS` / `STREAM_BATCH_MAX_SIZE` — declared in Task 8, used in `useEventStream.ts` only.
- Annotation `id` pattern uses existing `ANNOTATION_ID_PATTERN` — referenced consistently in Task 3 (`sanitizeAnnotation`).

### 4. Gaps found / fixed

- Initial draft omitted updating `src/components/__tests__/Dashboard.test.tsx`. Added as Task 10 Step 4.
- Initial draft omitted updating `src/lib/__tests__/validation.extra.test.ts`. Added as Task 12 Step 3.
- Initial draft used `WS_BATCH_*` constants in the new hook. Renamed to `STREAM_BATCH_*` in Task 8 to avoid the confusing carryover after `WS_BATCH_*` is deleted in Task 13.
