import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parseWorkflowFile, scanWorkflows } from "../workflow-scan";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-scan-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const FULL_FIXTURE = {
  runId: "wf_1abd6ed8-fdb",
  workflowName: "code-review-max-pr1055",
  status: "completed",
  startTime: 1780904327007,
  durationMs: 916017,
  agentCount: 18,
  totalTokens: 1234567,
  totalToolCalls: 214,
  summary: "code-review max: finder angles + verify + sweep",
  phases: [
    { title: "Find",   detail: "finder angles ..." },
    { title: "Verify", detail: "adversarial verifier ..." },
    { title: "Sweep",  detail: "fresh reviewer hunts gaps" },
  ],
  workflowProgress: [
    { type: "workflow_phase", index: "1", title: "Find" },
    {
      type: "workflow_agent",
      index: "1",
      label: "find:A-arialabel",
      phaseIndex: "1",
      phaseTitle: "Find",
      agentId: "ac37e2d69fd1abf90",
      model: "claude-opus-4-8[1m]",
      state: "done",
      tokens: "36188",
      toolCalls: "12",
      durationMs: "66957",
      startedAt: "1780904327016",
    },
    {
      type: "workflow_agent",
      index: "2",
      label: "verify:B",
      phaseIndex: "2",
      phaseTitle: "Verify",
      agentId: "bc12345",
      model: "claude-sonnet-4-5",
      state: "done",
      tokens: "12000",
      toolCalls: "5",
      durationMs: "30000",
      startedAt: "1780904393973",
    },
  ],
};

describe("parseWorkflowFile", () => {
  it("parses the full happy-path fixture correctly", async () => {
    const filePath = path.join(tmpDir, "wf_1abd6ed8-fdb.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).not.toBeNull();
    expect(result!.runId).toBe("wf_1abd6ed8-fdb");
    expect(result!.sessionId).toBe("sess-abc");
    expect(result!.name).toBe("code-review-max-pr1055");
    expect(result!.status).toBe("completed");
    expect(result!.startTime).toBe(1780904327007);
    expect(result!.durationMs).toBe(916017);
    expect(result!.agentCount).toBe(18);
    expect(result!.totalTokens).toBe(1234567);
    expect(result!.totalToolCalls).toBe(214);
    expect(result!.summary).toBe("code-review max: finder angles + verify + sweep");
  });

  it("maps phases with index, title, and detail", async () => {
    const filePath = path.join(tmpDir, "wf_phases.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.phases).toHaveLength(3);
    expect(result!.phases[0]).toEqual({ index: 1, title: "Find", detail: "finder angles ..." });
    expect(result!.phases[1]).toEqual({ index: 2, title: "Verify", detail: "adversarial verifier ..." });
    expect(result!.phases[2]).toEqual({ index: 3, title: "Sweep", detail: "fresh reviewer hunts gaps" });
  });

  it("maps workflow_agent entries to WorkflowAgentRef with coerced numeric fields", async () => {
    const filePath = path.join(tmpDir, "wf_agents.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.agents).toHaveLength(2);
    const agent = result!.agents[0];
    expect(agent.agentId).toBe("ac37e2d69fd1abf90");
    expect(agent.label).toBe("find:A-arialabel");
    expect(agent.phaseIndex).toBe(1);
    expect(agent.phaseTitle).toBe("Find");
    expect(agent.model).toBe("claude-opus-4-8[1m]");
    expect(agent.state).toBe("done");
    expect(agent.tokens).toBe(36188);
    expect(agent.toolCalls).toBe(12);
    expect(agent.durationMs).toBe(66957);
  });

  it("defaults absent status to 'running'", async () => {
    const fixture = { ...FULL_FIXTURE };
    const { status: _s, ...withoutStatus } = fixture;
    const filePath = path.join(tmpDir, "wf_running.json");
    await fs.writeFile(filePath, JSON.stringify(withoutStatus));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.status).toBe("running");
  });

  it("handles 'failed' status", async () => {
    const fixture = { ...FULL_FIXTURE, status: "failed" };
    const filePath = path.join(tmpDir, "wf_failed.json");
    await fs.writeFile(filePath, JSON.stringify(fixture));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.status).toBe("failed");
  });

  it("handles workflow with no phases", async () => {
    const fixture = { ...FULL_FIXTURE, phases: [] };
    const filePath = path.join(tmpDir, "wf_nophases.json");
    await fs.writeFile(filePath, JSON.stringify(fixture));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result!.phases).toHaveLength(0);
  });

  it("preserves label for default-type agents (no agentType override)", async () => {
    const filePath = path.join(tmpDir, "wf_generic.json");
    await fs.writeFile(filePath, JSON.stringify(FULL_FIXTURE));
    const result = parseWorkflowFile(filePath, "sess-abc");

    // All agents come through with their wf label intact
    expect(result!.agents[0].label).toBe("find:A-arialabel");
  });

  it("returns null for garbage file content", async () => {
    const filePath = path.join(tmpDir, "wf_garbage.json");
    await fs.writeFile(filePath, "not { valid json");
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).toBeNull();
  });

  it("returns null when runId is missing", async () => {
    const { runId: _r, ...withoutRunId } = FULL_FIXTURE;
    const filePath = path.join(tmpDir, "wf_norunid.json");
    await fs.writeFile(filePath, JSON.stringify(withoutRunId));
    const result = parseWorkflowFile(filePath, "sess-abc");

    expect(result).toBeNull();
  });
});

describe("scanWorkflows", () => {
  it("returns empty array when workflows dir does not exist", async () => {
    const result = await scanWorkflows(tmpDir, "no-such-session");
    expect(result).toEqual([]);
  });

  it("returns parsed runs for wf_*.json files", async () => {
    const sessionId = "sess-xyz";
    const wfDir = path.join(tmpDir, sessionId, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "wf_run1.json"), JSON.stringify(FULL_FIXTURE));
    await fs.writeFile(
      path.join(wfDir, "wf_run2.json"),
      JSON.stringify({ ...FULL_FIXTURE, runId: "wf_run2", workflowName: "other-flow" }),
    );
    // Non-matching file should be ignored
    await fs.writeFile(path.join(wfDir, "notaworkflow.json"), JSON.stringify(FULL_FIXTURE));

    const result = await scanWorkflows(tmpDir, sessionId);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.runId).sort();
    expect(ids).toContain("wf_1abd6ed8-fdb");
    expect(ids).toContain("wf_run2");
  });

  it("drops null results from garbage files", async () => {
    const sessionId = "sess-garbage";
    const wfDir = path.join(tmpDir, sessionId, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "wf_ok.json"), JSON.stringify(FULL_FIXTURE));
    await fs.writeFile(path.join(wfDir, "wf_bad.json"), "garbage");

    const result = await scanWorkflows(tmpDir, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("wf_1abd6ed8-fdb");
  });
});
