import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";

function getState() {
  return useAgentStore.getState();
}

describe("store – team functionality", () => {
  beforeEach(() => {
    // Reset the store to a clean state before each test
    useAgentStore.setState({
      agents: new Map(),
      edges: [],
      activity: [],
      teams: new Map(),
      selectedAgentId: null,
      selectedTeamId: null,
      connected: false,
    });
  });

  describe("team creation via agent:register", () => {
    it("creates a new team when agent registers with a teamId", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "build feature",
          teamId: "team-1",
        },
        1000,
      );

      const { teams } = getState();
      const team = teams.get("team-1");
      expect(team).toBeDefined();
      expect(team!.id).toBe("team-1");
      expect(team!.memberIds).toContain("a1");
      expect(team!.status).toBe("forming");
      expect(team!.startTime).toBe(1000);
    });

    it("adds agent to existing team", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
          teamId: "team-1",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
          teamId: "team-1",
        },
        1001,
      );

      const team = getState().teams.get("team-1")!;
      expect(team.memberIds).toEqual(["a1", "a2"]);
    });

    it("sets leader and status to active when team-lead registers", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "lead-1",
          agentType: "team-lead",
          task: "lead",
          teamId: "team-1",
        },
        1000,
      );

      const team = getState().teams.get("team-1")!;
      expect(team.leaderId).toBe("lead-1");
      expect(team.status).toBe("active");
    });
  });

  describe("team status transitions", () => {
    beforeEach(() => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
          teamId: "team-1",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
          teamId: "team-1",
        },
        1001,
      );
    });

    it("transitions to active when a member is running", () => {
      const { handleEvent } = getState();
      // Agents start as "running" on register, so agent:status running should keep active
      handleEvent(
        { type: "agent:status", agentId: "a1", status: "running" },
        1002,
      );

      const team = getState().teams.get("team-1")!;
      expect(team.status).toBe("active");
    });

    it("transitions to completed when all members complete", () => {
      const { handleEvent } = getState();
      handleEvent(
        { type: "agent:complete", agentId: "a1", duration: 500 },
        1002,
      );
      handleEvent(
        { type: "agent:complete", agentId: "a2", duration: 600 },
        1003,
      );

      const team = getState().teams.get("team-1")!;
      expect(team.status).toBe("completed");
    });

    it("transitions to error when any member has error status", () => {
      const { handleEvent } = getState();
      handleEvent(
        { type: "agent:status", agentId: "a1", status: "error" },
        1002,
      );

      const team = getState().teams.get("team-1")!;
      expect(team.status).toBe("error");
    });
  });

  describe("getTeamStats", () => {
    it("returns zeroed stats for unknown team", () => {
      const stats = getState().getTeamStats("nonexistent");
      expect(stats).toEqual({
        totalTokens: 0,
        totalCost: 0,
        memberCount: 0,
        completedCount: 0,
        errorCount: 0,
        activeCount: 0,
      });
    });

    it("calculates correct stats for team members", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
          teamId: "team-1",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
          teamId: "team-1",
        },
        1001,
      );
      // Set tokens for a1
      handleEvent(
        {
          type: "agent:tokens",
          agentId: "a1",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 200000,
        },
        1002,
      );
      // Complete a2
      handleEvent(
        { type: "agent:complete", agentId: "a2", duration: 500 },
        1003,
      );

      const stats = getState().getTeamStats("team-1");
      expect(stats.memberCount).toBe(2);
      expect(stats.totalTokens).toBe(150); // 100 input + 50 output from a1, a2 has 0
      expect(stats.completedCount).toBe(1);
      expect(stats.activeCount).toBe(1); // a1 is still running
    });
  });

  describe("team member removal", () => {
    it("removes agent from team memberIds", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
          teamId: "team-1",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
          teamId: "team-1",
        },
        1001,
      );

      getState().removeAgent("a1");

      const team = getState().teams.get("team-1")!;
      expect(team.memberIds).toEqual(["a2"]);
    });

    it("deletes team when last member is removed", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
          teamId: "team-1",
        },
        1000,
      );

      getState().removeAgent("a1");

      const team = getState().teams.get("team-1");
      expect(team).toBeUndefined();
    });
  });

  describe("message edges via agent:message", () => {
    it("creates a message edge between agents", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
        },
        1001,
      );
      handleEvent(
        { type: "agent:message", fromId: "a1", toId: "a2", content: "hello" },
        1002,
      );

      const { edges } = getState();
      const msgEdge = edges.find(
        (e) =>
          e.source === "a1" && e.target === "a2" && e.edgeType === "message",
      );
      expect(msgEdge).toBeDefined();
    });

    it("does not duplicate message edges", () => {
      const { handleEvent } = getState();
      handleEvent(
        {
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "task",
        },
        1000,
      );
      handleEvent(
        {
          type: "agent:register",
          agentId: "a2",
          agentType: "test",
          task: "task",
        },
        1001,
      );
      handleEvent(
        { type: "agent:message", fromId: "a1", toId: "a2", content: "hello" },
        1002,
      );
      handleEvent(
        {
          type: "agent:message",
          fromId: "a1",
          toId: "a2",
          content: "hello again",
        },
        1003,
      );

      const { edges } = getState();
      const msgEdges = edges.filter(
        (e) =>
          e.source === "a1" && e.target === "a2" && e.edgeType === "message",
      );
      expect(msgEdges).toHaveLength(1);
    });
  });

  describe("selectTeam", () => {
    it("sets selectedTeamId", () => {
      getState().selectTeam("team-1");
      expect(getState().selectedTeamId).toBe("team-1");
    });

    it("clears selectedTeamId when set to null", () => {
      getState().selectTeam("team-1");
      getState().selectTeam(null);
      expect(getState().selectedTeamId).toBeNull();
    });
  });
});
