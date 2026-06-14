import { describe, it, expect } from "vitest";
import { buildWorkflowLabelMap } from "@/lib/workflowLabels";
import { mockWorkflowRun } from "@/lib/__tests__/test-utils";
import type { WorkflowRunState } from "@/lib/types";

describe("buildWorkflowLabelMap", () => {
  it("maps agentId to its label", () => {
    const run = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "a1", label: "audit:dead-code", state: "running" }],
    });
    const map = buildWorkflowLabelMap(new Map([[run.runId, run]]));
    expect(map.get("a1")).toBe("audit:dead-code");
  });

  it("omits refs where label === agentId", () => {
    const run = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "a1", label: "a1", state: "running" }],
    });
    const map = buildWorkflowLabelMap(new Map([[run.runId, run]]));
    expect(map.has("a1")).toBe(false);
    expect(map.get("a1")).toBeUndefined();
  });

  it("omits refs with an empty-string label", () => {
    const run = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "a1", label: "", state: "running" }],
    });
    const map = buildWorkflowLabelMap(new Map([[run.runId, run]]));
    expect(map.has("a1")).toBe(false);
  });

  it("merges labels across multiple runs", () => {
    const run1 = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "a1", label: "audit:dead-code", state: "running" }],
    });
    const run2 = mockWorkflowRun({
      runId: "r2",
      agents: [{ agentId: "a2", label: "find:lint-errors", state: "running" }],
    });
    const workflows = new Map<string, WorkflowRunState>([
      [run1.runId, run1],
      [run2.runId, run2],
    ]);
    const map = buildWorkflowLabelMap(workflows);
    expect(map.get("a1")).toBe("audit:dead-code");
    expect(map.get("a2")).toBe("find:lint-errors");
  });
});
