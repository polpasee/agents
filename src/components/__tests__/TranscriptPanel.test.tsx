import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { TranscriptPanel } from "../TranscriptPanel";
import type { AgentEvent, ActivityEntry } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

let idCounter = 0;

function makeActivityEntry(event: AgentEvent, timestamp = 1000): ActivityEntry {
  idCounter++;
  return { id: String(idCounter), timestamp, event };
}

describe("TranscriptPanel", () => {
  beforeEach(() => {
    idCounter = 0;
    useAgentStore.setState({
      activity: [],
      agents: new Map(),
    });
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <TranscriptPanel open={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the panel when open is true", () => {
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText(/Transcript/)).toBeDefined();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<TranscriptPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close transcript panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── activity count display ──────────────────────────────────────────────

  it("displays the correct filtered/total counts in the header", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "main",
          task: "task1",
        }),
        makeActivityEntry({
          type: "agent:register",
          agentId: "a2",
          agentType: "build",
          task: "task2",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    // The text is split across nodes; use textContent on the whole header span
    const header = screen.getByText(
      (_content, element) => element?.textContent === "Transcript (2/2)",
    );
    expect(header).toBeDefined();
  });

  // ── event type rendering ────────────────────────────────────────────────

  it("renders agent:register events as 'Spawned: <task>'", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "explore",
          task: "explore the codebase",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("Spawned: explore the codebase")).toBeDefined();
  });

  it("renders agent:tool_call events with tool name and args", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:tool_call",
          agentId: "a1",
          tool: "Bash",
          args: "ls -la",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText(/Bash — ls -la/)).toBeDefined();
  });

  it("renders agent:status events as 'Status → <status>'", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:status",
          agentId: "a1",
          status: "waiting",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("Status → waiting")).toBeDefined();
  });

  it("renders agent:complete events", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:complete",
          agentId: "a1",
          duration: 1000,
          summary: "done with the task",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText(/Completed: done with the task/)).toBeDefined();
  });

  it("renders agent:message events with direction indicator", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:message",
          fromId: "a1",
          toId: "a2",
          content: "hello from a1",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText(/hello from a1/)).toBeDefined();
  });

  it("skips agent:tokens events (returns null)", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
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
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    // tokens are skipped; the header shows "Transcript (filtered/total)"
    // The text is split across nodes so we use a function matcher
    const header = screen.getByText(
      (_content, element) => element?.textContent === "Transcript (1/1)",
    );
    expect(header).toBeDefined();
    // tokens event is skipped (renders null), so no entry content is visible
    // The scroll container should have no child div elements rendered from events
    const scrollContainer = document.querySelector(
      ".flex-1.overflow-y-auto.custom-scrollbar",
    );
    expect(scrollContainer?.children.length).toBe(0);
  });

  // ── search / filter ─────────────────────────────────────────────────────

  it("renders a search input", () => {
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByPlaceholderText("Filter messages...")).toBeDefined();
  });

  it("filters activity entries by search term", () => {
    useAgentStore.setState({
      activity: [
        makeActivityEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "build",
          task: "unique-task-name",
        }),
        makeActivityEntry({
          type: "agent:register",
          agentId: "a2",
          agentType: "explore",
          task: "other-task",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Filter messages...");
    fireEvent.change(input, { target: { value: "unique-task-name" } });
    expect(screen.getByText("Spawned: unique-task-name")).toBeDefined();
    expect(screen.queryByText("Spawned: other-task")).toBeNull();
    // Filtered count updates — text is split across nodes
    const header = screen.getByText(
      (_content, element) => element?.textContent === "Transcript (1/2)",
    );
    expect(header).toBeDefined();
  });

  // ── agent color lookup from store ───────────────────────────────────────

  it("renders register event with color from agent lookup when agent exists in store", () => {
    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1", agentType: "explore" }));
    useAgentStore.setState({
      agents,
      activity: [
        makeActivityEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "explore",
          task: "explore task",
        }),
      ],
    });
    render(<TranscriptPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("Spawned: explore task")).toBeDefined();
  });
});
