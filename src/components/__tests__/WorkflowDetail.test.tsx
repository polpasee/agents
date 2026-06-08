import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { WorkflowDetail } from "../WorkflowDetail";
import type { WorkflowRunState } from "@/lib/types";

function makeRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "wf_detail-1",
    sessionId: "sess-main",
    name: "code-review-max",
    status: "completed",
    startTime: Date.now() - 120000,
    durationMs: 120000,
    agentCount: 2,
    totalTokens: 75000,
    totalToolCalls: 30,
    summary: "A detailed summary",
    phases: [
      { index: 1, title: "Find", detail: "finder agents" },
      { index: 2, title: "Verify", detail: "verifier agents" },
    ],
    agents: [
      { agentId: "ag-1", label: "find:alpha", state: "done", phaseIndex: 1, phaseTitle: "Find", tokens: 40000, toolCalls: 15 },
      { agentId: "ag-2", label: "verify:beta", state: "done", phaseIndex: 2, phaseTitle: "Verify", tokens: 35000, toolCalls: 15 },
    ],
    ...overrides,
  };
}

describe("WorkflowDetail", () => {
  beforeEach(() => {
    useAgentStore.setState({
      workflows: new Map(),
      selectedWorkflowId: null,
      agents: new Map(),
    });
  });

  it("renders nothing when no workflow is selected", () => {
    const { container } = render(<WorkflowDetail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when selectedWorkflowId does not match any run", () => {
    useAgentStore.setState({ selectedWorkflowId: "wf_nonexistent" });
    const { container } = render(<WorkflowDetail />);
    expect(container.innerHTML).toBe("");
  });

  it("renders rollups for the selected run", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("code-review-max")).toBeDefined();
    expect(screen.getByText(/completed/i)).toBeDefined();
    expect(screen.getByText(/75(\.0)?k|75000/)).toBeDefined();
  });

  it("renders per-phase progress bars", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("Find")).toBeDefined();
    expect(screen.getByText("Verify")).toBeDefined();
  });

  it("renders the per-agent table rows", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    expect(screen.getByText("find:alpha")).toBeDefined();
    expect(screen.getByText("verify:beta")).toBeDefined();
  });

  it("calls selectAgent when an agent row is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    const agentBtn = screen.getByText("find:alpha");
    fireEvent.click(agentBtn);
    expect(useAgentStore.getState().selectedAgentId).toBe("ag-1");
  });

  it("calls selectWorkflow(null) when close button is clicked", () => {
    const workflows = new Map<string, WorkflowRunState>();
    workflows.set("wf_detail-1", makeRun());
    useAgentStore.setState({ workflows, selectedWorkflowId: "wf_detail-1" });
    render(<WorkflowDetail />);

    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(useAgentStore.getState().selectedWorkflowId).toBeNull();
  });
});
