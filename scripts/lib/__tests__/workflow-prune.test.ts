import { describe, it, expect } from "vitest";
import { workflowRunIdsForSession } from "../discovery";
import type { WorkflowRunState } from "../../../src/lib/types";

function makeRun(runId: string, sessionId: string): WorkflowRunState {
  return {
    runId,
    sessionId,
    name: runId,
    status: "completed",
    startTime: 0,
    agentCount: 0,
    phases: [],
    agents: [],
  };
}

describe("workflowRunIdsForSession", () => {
  it("returns runIds belonging to the given sessionId", () => {
    const workflows = new Map<string, WorkflowRunState>([
      ["run-1", makeRun("run-1", "sess-A")],
      ["run-2", makeRun("run-2", "sess-A")],
      ["run-3", makeRun("run-3", "sess-B")],
    ]);

    const ids = workflowRunIdsForSession(workflows, "sess-A");
    expect(ids.sort()).toEqual(["run-1", "run-2"]);
  });

  it("returns only the matching session's runIds when sessions interleave", () => {
    const workflows = new Map<string, WorkflowRunState>([
      ["run-1", makeRun("run-1", "sess-A")],
      ["run-2", makeRun("run-2", "sess-B")],
      ["run-3", makeRun("run-3", "sess-A")],
      ["run-4", makeRun("run-4", "sess-C")],
    ]);

    const ids = workflowRunIdsForSession(workflows, "sess-A");
    expect(ids.sort()).toEqual(["run-1", "run-3"]);
  });

  it("returns empty array for a sessionId with no matching runs", () => {
    const workflows = new Map<string, WorkflowRunState>([
      ["run-1", makeRun("run-1", "sess-A")],
    ]);

    const ids = workflowRunIdsForSession(workflows, "sess-Z");
    expect(ids).toEqual([]);
  });

  it("returns empty array for an empty workflows map", () => {
    const ids = workflowRunIdsForSession(new Map(), "sess-A");
    expect(ids).toEqual([]);
  });
});
