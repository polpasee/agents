import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Mock-agents seeds JSONL files into PROJECTS_DIR so the discovery poller
 *  picks them up via the real code path. */
import { PROJECTS_DIR } from "./lib/config";

const MOCK_PREFIX = "-mock-agents-demo";
const MOCK_DIR = path.join(PROJECTS_DIR, MOCK_PREFIX);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

interface JsonlLine {
  timestamp: string;
  message: {
    role: "user" | "assistant" | "system";
    model?: string;
    content?: Array<{
      type: string;
      name?: string;
      input?: unknown;
      text?: string;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  meta?: { agentType?: string };
}

async function appendLine(file: string, line: JsonlLine): Promise<void> {
  await fs.appendFile(file, JSON.stringify(line) + "\n", "utf8");
}

async function writeFirstLine(
  file: string,
  slug: string,
  agentType: string,
): Promise<void> {
  const first: JsonlLine = {
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: `Mock session: ${slug}` }],
    },
    meta: { agentType },
  };
  await fs.writeFile(file, JSON.stringify(first) + "\n", "utf8");
}

async function cleanupMockDir(): Promise<void> {
  try {
    await fs.rm(MOCK_DIR, { recursive: true, force: true });
  } catch (err) {
    console.warn("[mock] cleanup failed:", err);
  }
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
        content: [
          {
            type: "tool_use",
            name: tool,
            input: { path: `/fake/${tool.toLowerCase()}.ts` },
          },
        ],
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
  await new Promise(() => {
    /* hang forever */
  });
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
