import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { TeamPanel } from "../TeamPanel";
import type { AgentState, TeamState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("TeamPanel", () => {
  beforeEach(() => {
    useAgentStore.setState({
      teams: new Map(),
      agents: new Map(),
      selectedTeamId: null,
    });
  });

  it("returns null when there are no teams", () => {
    const { container } = render(<TeamPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders team info when teams exist", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", teamId: "team-1" }));
    agents.set("a2", mockAgent({ id: "a2", teamId: "team-1", status: "completed" }));

    const teams = new Map<string, TeamState>();
    teams.set("team-1", {
      id: "team-1",
      name: "Alpha Squad",
      memberIds: ["a1", "a2"],
      status: "active",
      task: "Complete project",
      startTime: Date.now(),
    });

    useAgentStore.setState({ agents, teams });
    render(<TeamPanel />);

    expect(screen.getByText("Alpha Squad")).toBeDefined();
    expect(screen.getByText("Teams (1)")).toBeDefined();
    expect(screen.getByText("Complete project")).toBeDefined();
  });

  it("clicking the team card toggles selectedTeamId on then off", () => {
    const teams = new Map<string, TeamState>();
    teams.set("team-1", {
      id: "team-1",
      name: "Alpha Squad",
      memberIds: [],
      status: "active",
      task: "Some task",
      startTime: Date.now(),
    });

    useAgentStore.setState({ teams });
    render(<TeamPanel />);

    const cardButton = screen.getByText("Alpha Squad").closest("button")!;

    // First click: selectedTeamId should be set to "team-1"
    fireEvent.click(cardButton);
    expect(useAgentStore.getState().selectedTeamId).toBe("team-1");

    // Second click: selectedTeamId should be cleared back to null
    fireEvent.click(cardButton);
    expect(useAgentStore.getState().selectedTeamId).toBeNull();
  });

  it("expands the member list when selected; member click selects the agent without collapsing", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", teamId: "team-1" }));
    agents.set("a2", mockAgent({ id: "a2", teamId: "team-1", status: "completed" }));

    const teams = new Map<string, TeamState>();
    teams.set("team-1", {
      id: "team-1",
      name: "Alpha Squad",
      leaderId: "a1",
      memberIds: ["a1", "a2"],
      status: "active",
      task: "Complete project",
      startTime: Date.now(),
    });

    useAgentStore.setState({ agents, teams, selectedTeamId: "team-1" });
    render(<TeamPanel />);

    // Leader row and non-leader member row are visible
    expect(screen.getByText("Lead:")).toBeDefined();
    expect(screen.getByText("BUILD:a1")).toBeDefined();

    fireEvent.click(screen.getByText("BUILD:a2"));
    const state = useAgentStore.getState();
    expect(state.selectedAgentId).toBe("a2");
    expect(state.selectedTeamId).toBe("team-1");
  });
});
