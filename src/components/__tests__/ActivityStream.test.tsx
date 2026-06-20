import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ActivityStream } from "../ActivityStream";
import type { AgentEvent, ActivityEntry } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

let idCounter = 0;

function makeEntry(event: AgentEvent, timestamp = 1000): ActivityEntry {
  idCounter++;
  return { id: String(idCounter), timestamp, event };
}

describe("ActivityStream", () => {
  beforeEach(() => {
    idCounter = 0;
    useAgentStore.setState({
      activity: [],
      agents: new Map(),
      teams: new Map(),
    });
  });

  it("renders the 'Activity Stream' heading", () => {
    render(<ActivityStream />);
    expect(screen.getByText("Activity Stream")).toBeDefined();
  });

  it("shows empty state when there is no activity", () => {
    render(<ActivityStream />);
    expect(screen.getByText("Waiting for agent activity...")).toBeDefined();
  });

  it("renders an agent:register event", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "write the module",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText(/write the module/)).toBeDefined();
  });

  it("renders agent type and agentId for a register event", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:register",
          agentId: "abc123xyz",
          agentType: "explore",
          task: "t",
        }),
      ],
    });
    render(<ActivityStream />);
    // agentType:truncatedId should appear
    expect(screen.getByText(/explore:/)).toBeDefined();
  });

  it("renders parent spawned child for a register event with parentId", () => {
    const agents = new Map();
    agents.set("parent1", mockAgent({ id: "parent1", agentType: "main" }));
    useAgentStore.setState({
      agents,
      activity: [
        makeEntry({
          type: "agent:register",
          agentId: "child1",
          agentType: "build",
          task: "build thing",
          parentId: "parent1",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText(/spawned/)).toBeDefined();
  });

  it("renders agent:status event with status text", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:status",
          agentId: "a1",
          status: "waiting",
        }),
      ],
    });
    render(<ActivityStream />);
    // The status text is rendered with CSS `capitalize`, so the DOM text is lowercase
    expect(screen.getByText("waiting")).toBeDefined();
  });

  it("renders agent:status with optional message", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:status",
          agentId: "a1",
          status: "error",
          message: "something went wrong",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText(/something went wrong/)).toBeDefined();
  });

  it("renders agent:tool_call event", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:tool_call",
          agentId: "a1",
          tool: "ReadFile",
          args: "/src/index.ts",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText("ReadFile")).toBeDefined();
    expect(screen.getByText(/\/src\/index\.ts/)).toBeDefined();
  });

  it("renders agent:tool_call without args", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:tool_call",
          agentId: "a1",
          tool: "ListFiles",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText("ListFiles")).toBeDefined();
    expect(screen.getByText("called")).toBeDefined();
  });

  it("renders agent:message event with content", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:message",
          fromId: "a1",
          toId: "a2",
          content: "task complete",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText(/task complete/)).toBeDefined();
  });

  it("renders agent:complete event", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:complete",
          agentId: "a1",
          duration: 5000,
          summary: "finished successfully",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText("completed")).toBeDefined();
    expect(screen.getByText(/finished successfully/)).toBeDefined();
  });

  it("skips agent:tokens events (returns null row)", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:tokens",
          agentId: "a1",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          contextWindow: 200000,
        }),
      ],
    });
    render(<ActivityStream />);
    // No token data rendered; empty-state should not show either (it has 1 activity)
    // but nothing visible from the tokens event
    expect(screen.queryByText(/100/)).toBeNull();
  });

  it("renders a team badge when the agent:register event carries a teamId", () => {
    const teams = new Map();
    teams.set("team-1", { id: "team-1", name: "Alpha Team" });
    useAgentStore.setState({
      teams,
      activity: [
        makeEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "team build",
          teamId: "team-1",
        }),
      ],
    });
    render(<ActivityStream />);
    expect(screen.getByText("Alpha Team")).toBeDefined();
  });

  it("renders the log area with role='log'", () => {
    render(<ActivityStream />);
    expect(screen.getByRole("log")).toBeDefined();
  });
});
