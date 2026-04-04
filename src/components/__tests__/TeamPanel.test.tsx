import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
