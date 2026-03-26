import WebSocket from "ws";
import type { AgentEvent } from "../src/lib/types";

const WS_URL = process.env.WS_URL || "ws://localhost:4001";

function createReporter() {
  return new Promise<{
    send: (event: AgentEvent) => void;
    close: () => void;
  }>((resolve) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => {
      resolve({
        send: (event: AgentEvent) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
          }
        },
        close: () => ws.close(),
      });
    });
    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
  });
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

async function runSimulation() {
  console.log("Connecting to WebSocket server...");
  const reporter = await createReporter();
  console.log("Connected! Starting agent simulation...\n");

  const mainId = `main-${randomId()}`;

  // Register main agent
  reporter.send({
    type: "agent:register",
    agentId: mainId,
    agentType: "main",
    task: "Implement user authentication module",
  });
  console.log(`[MAIN] Registered: ${mainId}`);
  await sleep(1000);

  // Main agent starts working
  reporter.send({
    type: "agent:tool_call",
    agentId: mainId,
    tool: "Read",
    args: "src/auth/index.ts",
  });
  await sleep(800);

  reporter.send({
    type: "agent:tokens",
    agentId: mainId,
    inputTokens: 3200,
    outputTokens: 450,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });
  await sleep(1500);

  // Spawn Explorer sub-agent
  const exploreId = `explore-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: exploreId,
    parentId: mainId,
    agentType: "explore",
    task: "Search for existing auth patterns",
  });
  console.log(`[EXPLORE] Spawned: ${exploreId}`);
  await sleep(500);

  // Spawn Planner sub-agent
  const planId = `plan-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: planId,
    parentId: mainId,
    agentType: "plan",
    task: "Design auth architecture",
  });
  console.log(`[PLAN] Spawned: ${planId}`);
  await sleep(1000);

  // Explorer starts searching
  reporter.send({
    type: "agent:tool_call",
    agentId: exploreId,
    tool: "Grep",
    args: 'pattern: "authenticate"',
  });
  await sleep(600);

  reporter.send({
    type: "agent:tool_call",
    agentId: exploreId,
    tool: "Glob",
    args: "**/*.auth.ts",
  });
  await sleep(800);

  reporter.send({
    type: "agent:tokens",
    agentId: exploreId,
    inputTokens: 8500,
    outputTokens: 1200,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });
  await sleep(1200);

  // Planner works
  reporter.send({
    type: "agent:tool_call",
    agentId: planId,
    tool: "Read",
    args: "docs/api-spec.md",
  });
  await sleep(700);

  reporter.send({
    type: "agent:status",
    agentId: planId,
    status: "waiting",
    message: "Waiting for Explorer results",
  });
  await sleep(2000);

  // Explorer completes
  reporter.send({
    type: "agent:tool_call",
    agentId: exploreId,
    tool: "Read",
    args: "src/middleware/auth.ts",
  });
  await sleep(500);

  reporter.send({
    type: "agent:tokens",
    agentId: exploreId,
    inputTokens: 15000,
    outputTokens: 2100,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });

  reporter.send({
    type: "agent:complete",
    agentId: exploreId,
    summary: "Found 3 auth patterns: JWT, session, OAuth",
    duration: 8500,
  });
  console.log(`[EXPLORE] Completed`);
  await sleep(1000);

  // Planner resumes
  reporter.send({
    type: "agent:status",
    agentId: planId,
    status: "running",
  });
  await sleep(1500);

  reporter.send({
    type: "agent:tokens",
    agentId: planId,
    inputTokens: 12000,
    outputTokens: 3500,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });

  reporter.send({
    type: "agent:complete",
    agentId: planId,
    summary: "JWT-based auth with refresh tokens recommended",
    duration: 7200,
  });
  console.log(`[PLAN] Completed`);
  await sleep(1000);

  // Main agent updates tokens
  reporter.send({
    type: "agent:tokens",
    agentId: mainId,
    inputTokens: 25000,
    outputTokens: 5000,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });
  await sleep(500);

  // Spawn Build sub-agent
  const buildId = `build-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: buildId,
    parentId: mainId,
    agentType: "build",
    task: "Implement JWT auth middleware",
  });
  console.log(`[BUILD] Spawned: ${buildId}`);
  await sleep(800);

  // Build agent works
  const buildTools = [
    { tool: "Read", args: "src/middleware/index.ts" },
    { tool: "Edit", args: "src/middleware/jwt.ts" },
    { tool: "Write", args: "src/middleware/jwt.ts" },
    { tool: "Edit", args: "src/routes/auth.ts" },
    { tool: "Bash", args: "npm test -- --filter auth" },
  ];

  for (const tc of buildTools) {
    reporter.send({
      type: "agent:tool_call",
      agentId: buildId,
      tool: tc.tool,
      args: tc.args,
    });
    await sleep(1200);
  }

  reporter.send({
    type: "agent:tokens",
    agentId: buildId,
    inputTokens: 45000,
    outputTokens: 12000,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });
  await sleep(500);

  // Spawn Review sub-agent
  const reviewId = `review-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: reviewId,
    parentId: mainId,
    agentType: "review",
    task: "Review auth implementation",
  });
  console.log(`[REVIEW] Spawned: ${reviewId}`);
  await sleep(1500);

  reporter.send({
    type: "agent:tool_call",
    agentId: reviewId,
    tool: "Read",
    args: "src/middleware/jwt.ts",
  });
  await sleep(1000);

  reporter.send({
    type: "agent:tool_call",
    agentId: reviewId,
    tool: "Grep",
    args: 'pattern: "TODO|FIXME|HACK"',
  });
  await sleep(800);

  reporter.send({
    type: "agent:tokens",
    agentId: reviewId,
    inputTokens: 18000,
    outputTokens: 3000,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });

  // Build completes
  reporter.send({
    type: "agent:complete",
    agentId: buildId,
    summary: "JWT middleware implemented with refresh token rotation",
    duration: 15000,
  });
  console.log(`[BUILD] Completed`);
  await sleep(1000);

  // Review completes
  reporter.send({
    type: "agent:complete",
    agentId: reviewId,
    summary: "Code looks good, no security issues found",
    duration: 5000,
  });
  console.log(`[REVIEW] Completed`);
  await sleep(1500);

  // Main agent completes
  reporter.send({
    type: "agent:tokens",
    agentId: mainId,
    inputTokens: 65000,
    outputTokens: 18000,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });

  reporter.send({
    type: "agent:complete",
    agentId: mainId,
    summary: "Auth module fully implemented and reviewed",
    duration: 32000,
  });
  console.log(`[MAIN] Completed`);
  console.log("\nSimulation complete! Dashboard should show the full agent tree.");

  await sleep(5000);

  // --- Second wave: demonstrate error handling ---
  console.log("\n--- Starting second simulation (with error) ---\n");

  const main2Id = `main-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: main2Id,
    agentType: "main",
    task: "Add rate limiting to API",
  });
  console.log(`[MAIN2] Registered: ${main2Id}`);
  await sleep(1000);

  const testId = `test-${randomId()}`;
  reporter.send({
    type: "agent:register",
    agentId: testId,
    parentId: main2Id,
    agentType: "test",
    task: "Run integration tests",
  });
  console.log(`[TEST] Spawned: ${testId}`);
  await sleep(2000);

  reporter.send({
    type: "agent:tool_call",
    agentId: testId,
    tool: "Bash",
    args: "npm run test:integration",
  });
  await sleep(1500);

  // Test agent hits an error
  reporter.send({
    type: "agent:status",
    agentId: testId,
    status: "error",
    message: "Integration tests failed: 3 tests failing",
  });
  console.log(`[TEST] Error!`);
  await sleep(3000);

  reporter.send({
    type: "agent:tokens",
    agentId: main2Id,
    inputTokens: 12000,
    outputTokens: 3000,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
  });

  reporter.send({
    type: "agent:complete",
    agentId: main2Id,
    summary: "Rate limiting added, some tests need fixing",
    duration: 10000,
  });
  console.log(`[MAIN2] Completed`);

  console.log("\nAll simulations complete. Press Ctrl+C to exit.");
}

runSimulation().catch(console.error);
