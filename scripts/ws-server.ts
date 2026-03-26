import { WebSocketServer } from "ws";
import * as path from "path";
import * as os from "os";
import type { ServerEvent } from "../src/lib/types";
import { agents, edges, viewers } from "./lib/agent-state";
import { discoverActiveSessions } from "./lib/discovery";
import { WS_PORT, POLL_INTERVAL_MS } from "./lib/config";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// ── WebSocket Server ───────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT, host: "127.0.0.1" });

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
  };
  ws.send(JSON.stringify(syncEvent));

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
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms\n`);

discoverActiveSessions(PROJECTS_DIR);
console.log(`Found ${agents.size} active agent(s)\n`);

setInterval(() => {
  discoverActiveSessions(PROJECTS_DIR);
}, POLL_INTERVAL_MS);
