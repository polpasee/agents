import { WebSocketServer, WebSocket } from "ws";
import * as path from "node:path";
import * as os from "node:os";
import type { ServerEvent, ClientEvent, Annotation } from "../src/lib/types";
import { PROTOCOL_VERSION } from "../src/lib/types";
import { agents, edges, teams, viewers, getAgentFilePath } from "./lib/agent-state";
import { isValidClientEvent } from "../src/lib/validation";
import { readAgentLog } from "./lib/log-reader";
import { discoverActiveSessions } from "./lib/discovery";
import {
  WS_PORT,
  POLL_INTERVAL_MS,
  isAllowedOrigin,
  ANNOTATION_MAX_ENTRIES,
  ANNOTATION_MAX_TEXT_LENGTH,
  ANNOTATION_ID_PATTERN,
  USAGE_REFRESH_INTERVAL_MS,
  USAGE_REFRESH_THRESHOLD_MS,
} from "./lib/config";
import { loadWebhookConfig } from "./lib/webhooks";
import { readCacheMtime, triggerCcstatuslineRefresh } from "./lib/ccstatusline";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// ── Annotation storage ───────────────────────────────
const annotationStore = new Map<string, Annotation>();

function broadcastToViewers(event: ServerEvent | { type: string; [key: string]: unknown }) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    try { viewer.send(data); } catch { /* viewer abort, will self-remove */ }
  }
}

// ── WebSocket Server ───────────────────────────────────
// Origin allowlist guards against Cross-Site WebSocket Hijacking from random pages.
const wss = new WebSocketServer({
  port: WS_PORT,
  host: process.env.WS_HOST ?? "0.0.0.0",
  maxPayload: 256 * 1024,
  verifyClient: ({ origin }, done) => {
    if (isAllowedOrigin(origin)) return done(true);
    done(false, 403, "Forbidden origin");
  },
});

function sanitizeAnnotation(raw: unknown): Annotation | null {
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

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nError: Port ${WS_PORT} is already in use.`);
    console.error(`Another ws-server may still be running. Try:`);
    console.error(`  lsof -i :${WS_PORT}   # find the PID`);
    console.error(`  kill <PID>          # stop it\n`);
    process.exit(1);
  }
  throw err;
});

wss.on("connection", (ws) => {
  const adapter: import("./lib/sse-broadcast").SSEClient = {
    send: (data: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
  };
  viewers.add(adapter);

  const syncEvent: ServerEvent = {
    type: "state:sync",
    agents: Array.from(agents.values()),
    edges: [...edges],
    teams: Array.from(teams.values()),
    protocolVersion: PROTOCOL_VERSION,
  };
  ws.send(JSON.stringify(syncEvent));

  // Send annotation sync on connect
  if (annotationStore.size > 0) {
    const annSync: ServerEvent = {
      type: "annotation:sync",
      annotations: Array.from(annotationStore.values()),
    };
    ws.send(JSON.stringify(annSync));
  }

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw));
      if (!isValidClientEvent(data)) return;

      // Heartbeat ping — typed protocol member; reply pong and return.
      if (data.type === "ping") {
        const pong: ServerEvent = { type: "pong" };
        ws.send(JSON.stringify(pong));
        return;
      }

      if (data.type === "annotation:add") {
        const raw = (data as Extract<ClientEvent, { type: "annotation:add" }>).annotation;
        const ann = sanitizeAnnotation(raw);
        if (!ann) return;
        // Reject overwrite of an existing id — ids must be unique per session
        if (annotationStore.has(ann.id)) return;
        // Evict oldest entries if over cap
        while (annotationStore.size >= ANNOTATION_MAX_ENTRIES) {
          const oldest = annotationStore.keys().next().value;
          if (oldest === undefined) break;
          annotationStore.delete(oldest);
        }
        annotationStore.set(ann.id, ann);
        broadcastToViewers({ type: "annotation:update", action: "add", annotation: ann });
        return;
      }

      if (data.type === "annotation:remove") {
        const annId = (data as Extract<ClientEvent, { type: "annotation:remove" }>).annotationId;
        const ann = annotationStore.get(annId);
        if (ann) {
          annotationStore.delete(annId);
          broadcastToViewers({ type: "annotation:update", action: "remove", annotation: ann });
        }
        return;
      }

      if (data.type === "log:request") {
        const filePath = getAgentFilePath(data.agentId);
        if (!filePath) {
          const errEvent: ServerEvent = {
            type: "log:error",
            agentId: data.agentId,
            error: "Agent not found or no log file available",
          };
          ws.send(JSON.stringify(errEvent));
          return;
        }

        readAgentLog(filePath).then((entries) => {
          const response: ServerEvent = {
            type: "log:response",
            agentId: data.agentId,
            entries,
          };
          ws.send(JSON.stringify(response));
        }).catch((err) => {
          const errEvent: ServerEvent = {
            type: "log:error",
            agentId: data.agentId,
            error: `Failed to read log: ${err}`,
          };
          ws.send(JSON.stringify(errEvent));
        });
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    viewers.delete(adapter);
  });

  ws.on("error", () => {
    viewers.delete(adapter);
  });
});

// ── Polling loop ───────────────────────────────────────
console.log(`Agent Monitor WebSocket server running on ws://localhost:${WS_PORT}`);
console.log(`Watching: ${PROJECTS_DIR}`);
loadWebhookConfig();
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms\n`);

// Self-rescheduling loop: each cycle waits for the previous to complete before
// scheduling the next tick, so a slow disk pass never causes overlapping polls
// that block heartbeats or handshakes (P-H6).
let pollHandle: NodeJS.Timeout | null = null;
async function pollLoop(): Promise<void> {
  try {
    await discoverActiveSessions(PROJECTS_DIR);
  } catch (err) {
    console.warn("[poll] discovery failed:", err);
  } finally {
    pollHandle = setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

// Run an initial discovery immediately so the state is populated on startup,
// then hand off to the self-rescheduling loop.
discoverActiveSessions(PROJECTS_DIR).then(() => {
  console.log(`Found ${agents.size} active agent(s)\n`);
  pollLoop();
}).catch((err) => {
  console.warn("[startup] initial discovery failed:", err);
  pollLoop();
});

// ── Usage cache refresh loop ───────────────────────────
// Owns ccstatusline spawn cadence so /api/usage can stay a pure cache reader.
// Closes A-H3 (HTTP GET side effects) and S-L3 (TOCTOU on cooldown var).
// Self-rescheduling to prevent overlap on slow ccstatusline spawns (P-H6).
let usagePollHandle: NodeJS.Timeout | null = null;
async function usagePollLoop(): Promise<void> {
  try {
    const mtime = readCacheMtime();
    // No cache yet, or cache older than threshold → refresh.
    if (mtime === null || Date.now() - mtime > USAGE_REFRESH_THRESHOLD_MS) {
      triggerCcstatuslineRefresh();
    }
  } catch (err) {
    console.warn("[usage-poll] refresh failed:", err);
  } finally {
    usagePollHandle = setTimeout(usagePollLoop, USAGE_REFRESH_INTERVAL_MS);
  }
}
usagePollLoop();

// ── Graceful shutdown ──────────────────────────────────
function shutdown() {
  if (pollHandle) clearTimeout(pollHandle);
  if (usagePollHandle) clearTimeout(usagePollHandle);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
