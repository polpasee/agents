import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { WorkflowPanel } from "../WorkflowPanel";
import type { WorkflowRunState } from "@/lib/types";

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_test-1",
    sessionId: "sess-main",
    name: "code-review-max",
    status: "completed",
    startTime: Date.now() - 60000,
    agentCount: 3,
    totalTokens: 50000,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe("WorkflowPanel", () => {
  beforeEach(() => {
    useAgentStore.setState({
      workflows: new Map(),
      selectedWorkflowId: null,
    });
  });

  it("returns null when there are no workflow runs", () => {
    const { container } = render(<WorkflowPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders run info when workflows exist", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    expect(screen.getByText("code-review-max")).toBeDefined();
    expect(screen.getByText("Workflows (1)")).toBeDefined();
    expect(screen.getByText("completed")).toBeDefined();
  });

  it("calls selectWorkflow when a run row is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(useAgentStore.getState().selectedWorkflowId).toBe("wf_test-1");
  });

  it("deselects when clicking the already-selected run", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_test-1" });
    render(<WorkflowPanel />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(useAgentStore.getState().selectedWorkflowId).toBeNull();
  });

  it("shows agentCount and totalTokens in the run row", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_test-1", makeRun({ agentCount: 7, totalTokens: 123456 }));
    useAgentStore.setState({ workflows });
    render(<WorkflowPanel />);

    expect(screen.getByText(/7/)).toBeDefined();
    expect(screen.getByText(/123\.5k|123456/)).toBeDefined();
  });
});
