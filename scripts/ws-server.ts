import { WebSocketServer, WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  AgentEvent,
  AgentState,
  AgentType,
  EdgeState,
  ServerEvent,
  ToolCallEntry,
} from "../src/lib/types";

const PORT = Number(process.env.WS_PORT) || 4001;
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const POLL_INTERVAL = 1500; // ms
const DISCOVERY_THRESHOLD = 30 * 60 * 1000; // 30 minutes — include agents modified within this window
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes — mark agent as completed

// ── State ──────────────────────────────────────────────
const agents = new Map<string, AgentState>();
const edges: EdgeState[] = [];
const viewers = new Set<WebSocket>();
const fileOffsets = new Map<string, number>(); // track read position per file
const agentLastModified = new Map<string, number>(); // track last file mtime per agent
const removedAgentIds = new Set<string>(); // don't re-discover removed agents

// ── Broadcast ──────────────────────────────────────────
function broadcast(event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const viewer of viewers) {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(data);
    }
  }
}

// ── Parse agent type from meta.json or slug ────────────
function parseAgentType(raw?: string): AgentType {
  if (!raw) return "generic";
  const lower = raw.toLowerCase();
  if (lower.includes("explore") || lower.includes("Explore")) return "explore";
  if (lower.includes("plan") || lower.includes("Plan")) return "plan";
  if (lower.includes("build") || lower.includes("code-architect") || lower.includes("code-simplifier")) return "build";
  if (lower.includes("review") || lower.includes("code-review")) return "review";
  if (lower.includes("test") || lower.includes("pr-test")) return "test";
  if (lower.includes("team-lead")) return "team-lead";
  return "generic";
}

// ── Read new lines from a JSONL file ───────────────────
function readNewLines(filePath: string): string[] {
  const offset = fileOffsets.get(filePath) || 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (stat.size <= offset) return [];

  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  return buf
    .toString("utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

// ── Process a JSONL entry ──────────────────────────────
function processEntry(entry: Record<string, unknown>, agentId: string, sessionId: string) {
  const timestamp = entry.timestamp
    ? new Date(entry.timestamp as string).getTime()
    : Date.now();

  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return;

  const role = msg.role as string | undefined;

  // Extract tool calls from assistant messages
  if (role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content as Record<string, unknown>[]) {
      if (block.type === "tool_use") {
        const toolName = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        let argsStr: string | undefined;
        if (input) {
          // Summarize args
          const keys = Object.keys(input);
          if (keys.length <= 2) {
            argsStr = keys
              .map((k) => {
                const v = input[k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s?.slice(0, 60)}`;
              })
              .join(", ");
          } else {
            argsStr = keys.join(", ");
          }
        }

        const event: AgentEvent = {
          type: "agent:tool_call",
          agentId,
          tool: toolName,
          args: argsStr,
        };

        // Update agent state
        const agent = agents.get(agentId);
        if (agent) {
          const tc: ToolCallEntry = { tool: toolName, args: argsStr, timestamp };
          agent.toolCalls.push(tc);
          if (agent.toolCalls.length > 20) {
            agent.toolCalls = agent.toolCalls.slice(-20);
          }
          agent.status = "running";
        }

        broadcast({ type: "state:update", event, timestamp });
      }
    }

    // Extract token usage
    const usage = msg.usage as Record<string, number> | undefined;
    if (usage) {
      const agent = agents.get(agentId);
      if (agent) {
        agent.inputTokens = (agent.inputTokens || 0) + (usage.input_tokens || 0);
        agent.outputTokens = (agent.outputTokens || 0) + (usage.output_tokens || 0);
        agent.cacheReadTokens = (agent.cacheReadTokens || 0) + (usage.cache_read_input_tokens || 0);
        agent.cacheCreateTokens = (agent.cacheCreateTokens || 0) + (usage.cache_creation_input_tokens || 0);

        const event: AgentEvent = {
          type: "agent:tokens",
          agentId,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          cacheReadTokens: agent.cacheReadTokens,
          cacheCreateTokens: agent.cacheCreateTokens,
          contextWindow: agent.contextWindow,
        };
        broadcast({ type: "state:update", event, timestamp });
      }
    }
  }
}

// ── UUID pattern for session files ────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Extract task from first user message in JSONL ─────
function extractTaskFromJSONL(filePath: string, maxBytes = 16384): { task: string; slug: string; model: string; startTime?: number } {
  let result = { task: "", slug: "", model: "", startTime: undefined as number | undefined };
  try {
    const stat = fs.statSync(filePath);
    const chunk = Buffer.alloc(Math.min(stat.size, maxBytes));
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, chunk, 0, chunk.length, 0);
    fs.closeSync(fd);
    const lines = chunk.toString("utf-8").split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.timestamp && !result.startTime) {
          result.startTime = new Date(parsed.timestamp).getTime();
        }
        if (parsed.slug) result.slug = parsed.slug;
        if (parsed.message?.model) result.model = parsed.message.model;
        if (parsed.message?.role === "user" && !result.task) {
          const content = parsed.message.content;
          if (typeof content === "string") {
            result.task = content.slice(0, 100);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
            if (textBlock) result.task = (textBlock.text as string).slice(0, 100);
          }
        }
        if (result.task && result.model) break;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* ignore */ }
  return result;
}

// ── Register an agent and broadcast ──────────────────
function registerAgent(opts: {
  agentId: string;
  sessionId: string;
  projectDir: string;
  agentType: AgentType;
  parentId?: string;
  task: string;
  slug: string;
  model: string;
  startTime: number;
}) {
  const projectName = opts.projectDir.replace(/-/g, "/").replace(/^\//, "");

  const agent: AgentState = {
    id: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    status: "running",
    task: opts.task || "Session",
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1000000,
    startTime: opts.startTime,
    metadata: { projectName, projectDir: opts.projectDir },
  };

  agents.set(opts.agentId, agent);

  if (opts.parentId && agents.has(opts.parentId)) {
    edges.push({ source: opts.parentId, target: opts.agentId });
  }

  const event: AgentEvent = {
    type: "agent:register",
    agentId: opts.agentId,
    parentId: opts.parentId,
    agentType: opts.agentType,
    task: agent.task,
    sessionId: opts.sessionId,
    slug: opts.slug,
    model: opts.model,
  };
  broadcast({ type: "state:update", event, timestamp: Date.now() });
}

// ── Update agent status based on file recency ────────
function updateAgentStatus(agentId: string, mtimeMs: number) {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Track last modification time for stale detection
  const prev = agentLastModified.get(agentId) || 0;
  if (mtimeMs > prev) agentLastModified.set(agentId, mtimeMs);

  const timeSinceModified = Date.now() - mtimeMs;
  if (timeSinceModified < 10000) {
    if (agent.status !== "running") {
      agent.status = "running";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "running" },
        timestamp: Date.now(),
      });
    }
  } else if (timeSinceModified < 60000) {
    if (agent.status === "running") {
      agent.status = "idle";
      broadcast({
        type: "state:update",
        event: { type: "agent:status", agentId, status: "idle" },
        timestamp: Date.now(),
      });
    }
  }
}

// ── Discover and watch sessions ────────────────────────
function discoverActiveSessions() {
  if (!fs.existsSync(PROJECTS_DIR)) return;

  const projectDirs = fs.readdirSync(PROJECTS_DIR).filter((d) => {
    const p = path.join(PROJECTS_DIR, d);
    return fs.statSync(p).isDirectory();
  });

  for (const projectDir of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(projectPath);
    } catch {
      continue;
    }

    // ── Step 1: Discover main session agents ──────────
    // Main session JSONL files are at the project root: {sessionId}.jsonl
    const mainJsonlFiles = entries.filter((f) => {
      if (!f.endsWith(".jsonl")) return false;
      const sessionId = f.replace(".jsonl", "");
      return UUID_RE.test(sessionId);
    });

    for (const mainJsonl of mainJsonlFiles) {
      const sessionId = mainJsonl.replace(".jsonl", "");
      const filePath = path.join(projectPath, mainJsonl);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      const age = Date.now() - stat.mtimeMs;
      if (age > DISCOVERY_THRESHOLD) continue;

      // Register main agent using sessionId as its ID
      if (!agents.has(sessionId)) {
        // If file is active again (modified within stale threshold), allow re-discovery
        if (removedAgentIds.has(sessionId) && age > STALE_THRESHOLD) continue;
        removedAgentIds.delete(sessionId);

        const info = extractTaskFromJSONL(filePath);
        registerAgent({
          agentId: sessionId,
          sessionId,
          projectDir,
          agentType: "main",
          task: info.task,
          slug: info.slug,
          model: info.model,
          startTime: info.startTime || stat.mtimeMs,
        });
      }

      // Read new lines from main session
      const newLines = readNewLines(filePath);
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line);
          processEntry(entry, sessionId, sessionId);
        } catch { /* skip */ }
      }

      updateAgentStatus(sessionId, stat.mtimeMs);
    }

    // ── Step 2: Discover sub-agents ──────────────────
    const sessionDirs = entries.filter((d) => {
      const p = path.join(projectPath, d);
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });

    for (const sessionId of sessionDirs) {
      const subagentsDir = path.join(projectPath, sessionId, "subagents");
      if (!fs.existsSync(subagentsDir)) continue;

      let files: string[];
      try {
        files = fs.readdirSync(subagentsDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(subagentsDir, jsonlFile);

        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        const age = Date.now() - stat.mtimeMs;
        if (age > DISCOVERY_THRESHOLD) continue;

        // Extract agentId from filename: agent-{agentId}.jsonl
        const agentIdMatch = jsonlFile.match(/^agent-(.+)\.jsonl$/);
        if (!agentIdMatch) continue;
        const agentId = agentIdMatch[1];

        // Skip compact files (they're compacted history, not active agents)
        if (agentId.startsWith("compact-")) continue;

        // Read meta if exists
        const metaFile = `agent-${agentId}.meta.json`;
        let agentType: AgentType = "generic";
        let description = "";
        if (metaFiles.includes(metaFile)) {
          try {
            const meta = JSON.parse(
              fs.readFileSync(path.join(subagentsDir, metaFile), "utf-8")
            );
            agentType = parseAgentType(meta.agentType);
            description = meta.description || "";
          } catch { /* ignore */ }
        }

        // Register agent if new
        if (!agents.has(agentId)) {
          if (removedAgentIds.has(agentId) && age > STALE_THRESHOLD) continue;
          removedAgentIds.delete(agentId);

          const info = extractTaskFromJSONL(filePath);

          // Parent is the main session agent
          const parentId = sessionId;

          registerAgent({
            agentId,
            sessionId,
            projectDir,
            agentType,
            parentId,
            task: description || info.task,
            slug: info.slug,
            model: info.model,
            startTime: info.startTime || stat.mtimeMs,
          });
        }

        // Read new lines
        const newLines = readNewLines(filePath);
        for (const line of newLines) {
          try {
            const entry = JSON.parse(line);
            processEntry(entry, agentId, sessionId);
          } catch { /* skip */ }
        }

        updateAgentStatus(agentId, stat.mtimeMs);
      }
    }
  }

  // Remove stale agents based on file modification time
  for (const [agentId, agent] of agents) {
    if (agent.status === "running" || agent.status === "idle") {
      const lastMod = agentLastModified.get(agentId) || agent.startTime;
      const timeSinceModified = Date.now() - lastMod;
      if (timeSinceModified > STALE_THRESHOLD) {
        agents.delete(agentId);
        agentLastModified.delete(agentId);
        removedAgentIds.add(agentId);
        // Remove edges involving this agent
        const edgesBefore = edges.length;
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].source === agentId || edges[i].target === agentId) {
            edges.splice(i, 1);
          }
        }
        broadcast({ type: "state:remove", agentId });
      }
    }
  }
}

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

  // Send full state sync
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
console.log(`Poll interval: ${POLL_INTERVAL}ms`);
console.log(`Stale threshold: ${STALE_THRESHOLD / 1000}s\n`);

// Initial scan
discoverActiveSessions();
console.log(`Found ${agents.size} active agent(s)\n`);

// Poll for changes
setInterval(() => {
  discoverActiveSessions();
}, POLL_INTERVAL);
