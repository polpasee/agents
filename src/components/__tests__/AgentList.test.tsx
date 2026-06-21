import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentList } from "../AgentList";
import type { AgentState } from "@/lib/types";
import { mockAgent, mockWorkflowRun } from "@/lib/__tests__/test-utils";

describe("AgentList", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      hiddenAgentTypes: new Set(),
      teams: new Map(),
      selectedTeamId: null,
      workflows: new Map(),
    });
  });

  it("shows 'No agents connected' when empty", () => {
    render(<AgentList />);
    expect(screen.getByText("No agents connected")).toBeDefined();
  });

  it("renders agent rows when agents exist", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", task: "Write tests" }));
    agents.set(
      "a2",
      mockAgent({ id: "a2", agentType: "build", task: "Build project" }),
    );

    useAgentStore.setState({ agents });
    render(<AgentList />);

    expect(screen.getByText("Agents (2)")).toBeDefined();
    expect(screen.getByText("Write tests")).toBeDefined();
    expect(screen.getByText("Build project")).toBeDefined();
  });

  it("shows the workflow label verbatim for a workflow agent", () => {
    const agents = new Map<string, AgentState>();
    agents.set("wf1", mockAgent({ id: "wf1", task: "scan code" }));

    const run = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "wf1", label: "audit:dead-code", state: "running" }],
    });

    useAgentStore.setState({ agents, workflows: new Map([[run.runId, run]]) });
    render(<AgentList />);

    expect(screen.getByText(/audit:dead-code/)).toBeDefined();
    expect(screen.queryByText(/WORKFLOW-SUBAGENT/)).toBeNull();
    expect(screen.queryByText("AUDIT:DEAD-CODE")).toBeNull();
  });

  it("uses the uppercased-type fallback for a plain agent even when the workflows map is populated", () => {
    const agents = new Map<string, AgentState>();
    agents.set("wf1", mockAgent({ id: "wf1", task: "scan code" }));
    agents.set(
      "p1",
      mockAgent({ id: "p1", agentType: "build", task: "build it" }),
    );

    const run = mockWorkflowRun({
      runId: "r1",
      agents: [{ agentId: "wf1", label: "audit:dead-code", state: "running" }],
    });

    useAgentStore.setState({ agents, workflows: new Map([[run.runId, run]]) });
    render(<AgentList />);

    expect(screen.getByText(/audit:dead-code/)).toBeDefined();
    expect(screen.getByText(/BUILD/)).toBeDefined();
  });

  it("still renders the uppercased type for a non-workflow agent", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "b1",
      mockAgent({ id: "b1", agentType: "build", task: "build it" }),
    );

    useAgentStore.setState({ agents });
    render(<AgentList />);

    expect(screen.getByText(/BUILD/)).toBeDefined();
  });

  it("renders workflowName uppercased when agent has workflowName and no store label", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "live1",
      mockAgent({
        id: "live1",
        workflowName: "code-review-max",
        task: "reviewing",
      }),
    );

    useAgentStore.setState({ agents, workflows: new Map() });
    render(<AgentList />);

    expect(screen.getByText(/CODE-REVIEW-MAX/)).toBeDefined();
  });

  it("real store label wins over workflowName in AgentList", () => {
    const agents = new Map<string, AgentState>();
    agents.set(
      "wf2",
      mockAgent({
        id: "wf2",
        workflowName: "code-review-max",
        task: "reviewing",
      }),
    );

    const run = mockWorkflowRun({
      runId: "r2",
      agents: [{ agentId: "wf2", label: "real-label", state: "running" }],
    });

    useAgentStore.setState({ agents, workflows: new Map([[run.runId, run]]) });
    render(<AgentList />);

    expect(screen.getByText(/real-label/)).toBeDefined();
    expect(screen.queryByText(/CODE-REVIEW-MAX/)).toBeNull();
  });
});
