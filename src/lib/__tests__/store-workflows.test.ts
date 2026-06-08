import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";
import type { WorkflowRunState } from "../types";

function getState() {
  return useAgentStore.getState();
}

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_test-1",
    sessionId: "sess-main",
    name: "test-workflow",
    status: "running",
    startTime: 1000,
    agentCount: 2,
    phases: [{ index: 1, title: "Phase A" }],
    agents: [
      { agentId: "ag-1", label: "find:alpha", state: "done", phaseIndex: 1, phaseTitle: "Phase A" },
      { agentId: "ag-2", label: "verify:beta", state: "running", phaseIndex: 1, phaseTitle: "Phase A" },
    ],
    ...overrides,
  };
}

describe("store – workflow functionality", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      workflows: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
      selectedWorkflowId: null,
      connected: false,
    });
  });

  describe("syncState with workflows", () => {
    it("populates the workflows Map from the 4th arg", () => {
      const run = makeRun();
      getState().syncState([], [], [], [run]);
      const { workflows } = getState();
      expect(workflows.size).toBe(1);
      expect(workflows.get("wf_test-1")).toEqual(run);
    });

    it("replaces existing workflows on re-sync", () => {
      getState().syncState([], [], [], [makeRun({ runId: "wf_old" })]);
      getState().syncState([], [], [], [makeRun({ runId: "wf_new" })]);
      const { workflows } = getState();
      expect(workflows.has("wf_old")).toBe(false);
      expect(workflows.has("wf_new")).toBe(true);
    });

    it("accepts empty workflows array", () => {
      getState().syncState([], [], [], []);
      expect(getState().workflows.size).toBe(0);
    });
  });

  describe("upsertWorkflow", () => {
    it("inserts a new workflow run", () => {
      const run = makeRun();
      getState().upsertWorkflow(run);
      expect(getState().workflows.get("wf_test-1")).toEqual(run);
    });

    it("updates an existing workflow run", () => {
      getState().upsertWorkflow(makeRun({ status: "running" }));
      getState().upsertWorkflow(makeRun({ status: "completed" }));
      expect(getState().workflows.get("wf_test-1")!.status).toBe("completed");
    });
  });

  describe("removeWorkflow", () => {
    it("removes a workflow run by runId", () => {
      getState().upsertWorkflow(makeRun());
      getState().removeWorkflow("wf_test-1");
      expect(getState().workflows.has("wf_test-1")).toBe(false);
    });

    it("is a no-op for unknown runId", () => {
      expect(() => getState().removeWorkflow("wf_nonexistent")).not.toThrow();
    });
  });

  describe("selectWorkflow", () => {
    it("sets selectedWorkflowId", () => {
      getState().selectWorkflow("wf_test-1");
      expect(getState().selectedWorkflowId).toBe("wf_test-1");
    });

    it("clears selectedWorkflowId when set to null", () => {
      getState().selectWorkflow("wf_test-1");
      getState().selectWorkflow(null);
      expect(getState().selectedWorkflowId).toBeNull();
    });
  });
});
