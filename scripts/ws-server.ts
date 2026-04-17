import { WebSocketServer, WebSocket } from "ws";
import * as path from "path";
import * as os from "os";
import type { ServerEvent, ClientEvent, Annotation } from "../src/lib/types";
import { agents, edges, teams, viewers, getAgentFilePath } from "./lib/agent-state";
import { isValidClientEvent } from "../src/lib/validation";
import { readAgentLog } from "./lib/log-reader";
import { discoverActiveSessions } from "./lib/discovery";
import {
  WS_PORT,
  POLL_INTERVAL_MS,
  WS_ALLOWED_ORIGINS,
  ANNOTATION_MAX_ENTRIES,
  ANNOTATION_MAX_TEXT_LENGTH,
  ANNOTATION_ID_PATTERN,
} from "./lib/config";
import { loadWebhookConfig } from "./lib/webhooks";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// ── Annotation storage ───────────────────────────────
const annotationStore = new Map<string, Annotation>();

function broadcastToViewers(event: ServerEvent | { type: string; [key: string]: unknown }) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    if ((viewer as WebSocket).readyState === WebSocket.OPEN) {
      viewer.send(data);
    }
  }
}

// ── WebSocket Server ───────────────────────────────────
// Origin allowlist guards against Cross-Site WebSocket Hijacking from random pages.
const wss = new WebSocketServer({
  port: WS_PORT,
  host: "127.0.0.1",
  verifyClient: ({ origin }, done) => {
    if (!origin || WS_ALLOWED_ORIGINS.includes(origin)) return done(true);
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
  viewers.add(ws);

  const syncEvent: ServerEvent = {
    type: "state:sync",
    agents: Array.from(agents.values()),
    edges: [...edges],
    teams: Array.from(teams.values()),
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
      // Handle heartbeat ping
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (!isValidClientEvent(data)) return;

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

        try {
          const entries = readAgentLog(filePath);
          const response: ServerEvent = {
            type: "log:response",
            agentId: data.agentId,
            entries,
          };
          ws.send(JSON.stringify(response));
        } catch (err) {
          const errEvent: ServerEvent = {
            type: "log:error",
            agentId: data.agentId,
            error: `Failed to read log: ${err}`,
          };
          ws.send(JSON.stringify(errEvent));
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    viewers.delete(ws);
  });

  ws.on("error", () => {
    viewers.delete(ws);
  });
});

// ── Polling loop ───────────────────────────────────────
console.log(`Agent Monitor WebSocket server running on ws://localhost:${WS_PORT}`);
console.log(`Watching: ${PROJECTS_DIR}`);
loadWebhookConfig();
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms\n`);

discoverActiveSessions(PROJECTS_DIR);
console.log(`Found ${agents.size} active agent(s)\n`);

setInterval(() => {
  discoverActiveSessions(PROJECTS_DIR);
}, POLL_INTERVAL_MS);
