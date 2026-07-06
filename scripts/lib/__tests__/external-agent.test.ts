import { describe, it, expect, beforeEach } from "vitest";
import {
  isCodexCommand,
  maybeRegisterExternalAgent,
  maybeCompleteExternalAgent,
} from "../external-agent";
import {
  registerAgent,
  processEntry,
  agents,
  edges,
  agentLastModified,
  viewers,
} from "../agent-state";

describe("isCodexCommand", () => {
  it.each([
    "codex",
    'codex exec "x"',
    "./codex",
    "path/to/codex --help",
    "/usr/local/bin/codex run",
    "foo && codex",
    "a || codex exec x",
    "cat x | codex",
    "(codex)",
    "codex;echo done",
    "codex&",
    "codex>run.log",
    "codex|tee log",
    "true; codex exec x",
    "rtk proxy codex",
    'rtk proxy codex exec "x"',
    "rtk proxy ./codex run",
    "rtk proxy /usr/local/bin/codex run",
    "true && rtk proxy codex exec x",
    'J=/tmp/x; WTB=/tmp/y; rtk proxy codex -a never exec -s workspace-write -C "$WTB" --json',
    "/usr/local/bin/rtk proxy codex run",
    "./rtk proxy codex run",
    "rtk\tproxy\tcodex exec x",
  ])("matches %j", (cmd) => {
    expect(isCodexCommand(cmd)).toBe(true);
  });

  it.each([
    'git commit -m "run codex before merge"',
    'echo "start codex now"',
    "grep codex scripts/lib",
    "which codex",
    "man codex",
    "brew install codex",
    "cat codex.md",
    "codex.ts",
    "mycodex",
    "echo codexample",
    "ls -la",
    "rm codex",
    "rtk git status",
    "rtk gain",
    "rtk gain --history",
    "rtk discover",
    "rtk proxy npx codex-lint",
    "rtk proxy codex-lint",
    "rtk proxy",
    "npx codex",
    "sudo codex",
    "env X=Y codex",
    // continuation / heredoc line beginning with "codex" is NOT an invocation
    "cat > notes.txt <<EOF\ncodex is great\nEOF",
    "printf hi\ncodex mentioned here",
    // a newline inside the rtk-proxy prefix must not bridge to an unrelated
    // "codex" mention on a following line
    "rtk proxy\ncodex is not what we want here",
    "rtk\nproxy codex exec x",
  ])("does not match %j", (cmd) => {
    expect(isCodexCommand(cmd)).toBe(false);
  });
});

describe("maybeRegisterExternalAgent", () => {
  const T0 = 1_000_000;

  const seedParent = () =>
    registerAgent({
      agentId: "main1",
      sessionId: "main1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: T0,
    });

  const codexBlock = {
    type: "tool_use",
    id: "toolu_1",
    name: "Bash",
    input: { command: 'codex exec "x"', description: "Run Codex" },
  };

  beforeEach(() => {
    agents.clear();
    edges.length = 0;
    agentLastModified.clear();
  });

  it("synthesizes a hollow Codex sub-agent, returns true, hangs it off the caller", () => {
    seedParent();
    expect(maybeRegisterExternalAgent(codexBlock, "main1", T0)).toBe(true);

    const node = agents.get("codex:toolu_1");
    expect(node).toBeDefined();
    expect(node?.parentId).toBe("main1");
    expect(node?.displayType).toBe("Codex");
    expect(node?.model).toBe("codex");
    expect(node?.status).toBe("running");
    expect(node?.task).toBe("Run Codex");
    expect(edges).toContainEqual({ source: "main1", target: "codex:toolu_1" });
  });

  it("returns false and creates no node for a non-codex Bash call", () => {
    seedParent();
    expect(
      maybeRegisterExternalAgent(
        {
          type: "tool_use",
          id: "toolu_2",
          name: "Bash",
          input: { command: "ls -la" },
        },
        "main1",
        T0,
      ),
    ).toBe(false);
    expect(agents.has("codex:toolu_2")).toBe(false);
  });

  it("returns false for a non-Bash block", () => {
    seedParent();
    expect(
      maybeRegisterExternalAgent(
        {
          type: "tool_use",
          id: "toolu_3",
          name: "Read",
          input: { command: "codex exec x" },
        },
        "main1",
        T0,
      ),
    ).toBe(false);
    expect(agents.has("codex:toolu_3")).toBe(false);
  });

  it("returns false and registers nothing for a codex command with no id", () => {
    seedParent();
    expect(
      maybeRegisterExternalAgent(
        { type: "tool_use", name: "Bash", input: { command: "codex exec x" } },
        "main1",
        T0,
      ),
    ).toBe(false);
    expect(agents.has("codex:undefined")).toBe(false);
    expect([...agents.keys()].some((k) => k.startsWith("codex:"))).toBe(false);
  });

  it("is idempotent across re-reads: true both times, exactly one node and one edge", () => {
    seedParent();
    expect(maybeRegisterExternalAgent(codexBlock, "main1", T0)).toBe(true);
    expect(maybeRegisterExternalAgent(codexBlock, "main1", T0)).toBe(true);

    expect([...agents.keys()].filter((k) => k.startsWith("codex:"))).toEqual([
      "codex:toolu_1",
    ]);
    const codexEdges = edges.filter((e) => e.target === "codex:toolu_1");
    expect(codexEdges).toHaveLength(1);
  });
});

describe("maybeCompleteExternalAgent", () => {
  const T0 = 1_000_000;
  let sent: Array<{ type: string; event?: Record<string, unknown> }>;

  const register = (id = "toolu_1") =>
    maybeRegisterExternalAgent(
      {
        type: "tool_use",
        id,
        name: "Bash",
        input: { command: "codex exec x" },
      },
      "main1",
      T0,
    );

  beforeEach(() => {
    agents.clear();
    edges.length = 0;
    agentLastModified.clear();
    viewers.clear();
    sent = [];
    viewers.add({ send: (data: string) => sent.push(JSON.parse(data)) });
    registerAgent({
      agentId: "main1",
      sessionId: "main1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: T0,
    });
    register();
  });

  it("flips the node to idle with a duration on a successful tool_result", () => {
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: "toolu_1" },
      T0 + 1000,
    );

    const node = agents.get("codex:toolu_1");
    expect(node?.status).toBe("idle"); // NOT "completed"
    expect(node?.duration).toBe(1000);
  });

  it("flips the node to error when the tool_result reports a failure", () => {
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: "toolu_1", is_error: true },
      T0 + 1000,
    );

    const node = agents.get("codex:toolu_1");
    expect(node?.status).toBe("error");
    expect(node?.duration).toBe(1000);
  });

  it("broadcasts an agent:status event for the codex node", () => {
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: "toolu_1" },
      T0 + 1000,
    );

    const status = sent.find(
      (m) =>
        m.type === "state:update" &&
        m.event?.type === "agent:status" &&
        m.event?.agentId === "codex:toolu_1",
    );
    expect(status?.event?.status).toBe("idle");
  });

  it("is idempotent — a second tool_result does not re-run the terminal node", () => {
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: "toolu_1" },
      T0 + 1000,
    );
    maybeCompleteExternalAgent(
      { type: "tool_result", tool_use_id: "toolu_1" },
      T0 + 9000,
    );

    const node = agents.get("codex:toolu_1");
    expect(node?.status).toBe("idle");
    expect(node?.duration).toBe(1000);
  });

  it("does nothing for a tool_result with an unknown tool_use_id", () => {
    expect(() =>
      maybeCompleteExternalAgent(
        { type: "tool_result", tool_use_id: "toolu_unknown" },
        T0 + 1000,
      ),
    ).not.toThrow();
    expect(agents.has("codex:toolu_unknown")).toBe(false);
  });
});

describe("processEntry integration — codex node vs suppressed tool spoke", () => {
  const T0 = 1_000_000;

  const assistantBash = (id: string, command: string) => ({
    timestamp: new Date(T0).toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  });

  beforeEach(() => {
    agents.clear();
    edges.length = 0;
    agentLastModified.clear();
    viewers.clear();
    registerAgent({
      agentId: "a1",
      sessionId: "a1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: T0,
    });
  });

  it("registers the codex node and suppresses the owner's Bash tool spoke", () => {
    processEntry(assistantBash("toolu_1", 'codex exec "x"'), "a1");

    expect(agents.get("codex:toolu_1")?.parentId).toBe("a1");
    // The suppressed call must NOT show up as a generic Bash spoke on the owner.
    expect(agents.get("a1")?.toolCalls.some((tc) => tc.tool === "Bash")).toBe(
      false,
    );
  });

  it("completes the codex node to idle on the matching tool_result", () => {
    processEntry(assistantBash("toolu_1", 'codex exec "x"'), "a1");
    processEntry(
      {
        timestamp: new Date(T0 + 1000).toISOString(),
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1" }],
        },
      },
      "a1",
    );

    expect(agents.get("codex:toolu_1")?.status).toBe("idle");
  });

  it("records a normal Bash spoke for a non-codex command and creates no codex node", () => {
    processEntry(assistantBash("toolu_2", "ls"), "a1");

    expect([...agents.keys()].some((k) => k.startsWith("codex:"))).toBe(false);
    const tc = agents.get("a1")?.toolCalls.find((t) => t.tool === "Bash");
    expect(tc).toBeDefined();
    expect(tc?.args).toContain("ls");
  });
});
