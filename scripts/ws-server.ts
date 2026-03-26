import { WebSocketServer } from "ws";
import * as path from "path";
import * as os from "os";
import type { ServerEvent } from "../src/lib/types";
import { agents, edges, viewers } from "./lib/agent-state";
import { discoverActiveSessions } from "./lib/discovery";

const PORT = Number(process.env.WS_PORT) || 4001;
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const POLL_INTERVAL = 1500; // ms

// ── WebSocket Server ───────────────────────────────────
const wss = new WebSocketServer({ port: PORT });

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nError: Port ${PORT} is already in use.`);
    console.error(`Another ws-server may still be running. Try:`);
    console.error(`  lsof -i :${PORT}   # find the PID`);
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
});

// ── Polling loop ───────────────────────────────────────
console.log(`Agent Monitor WebSocket server running on ws://localhost:${PORT}`);
console.log(`Watching: ${PROJECTS_DIR}`);
console.log(`Poll interval: ${POLL_INTERVAL}ms\n`);

discoverActiveSessions(PROJECTS_DIR);
console.log(`Found ${agents.size} active agent(s)\n`);

setInterval(() => {
  discoverActiveSessions(PROJECTS_DIR);
}, POLL_INTERVAL);
