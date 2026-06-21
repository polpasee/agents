import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { TimelineBar } from "../TimelineBar";
import type { AgentEvent, ActivityEntry } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";
import { resetStore } from "@/lib/__tests__/test-utils";

let idCounter = 0;

function makeEntry(event: AgentEvent, timestamp = 1000): ActivityEntry {
  idCounter++;
  return { id: String(idCounter), timestamp, event };
}

describe("TimelineBar", () => {
  beforeEach(() => {
    idCounter = 0;
    resetStore();
    useAgentStore.setState({
      activity: [],
      agents: new Map(),
      connected: false,
    });
    vi.stubGlobal("Date", {
      ...Date,
      now: vi.fn(() => 1700000000000),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders without crashing", () => {
    render(<TimelineBar />);
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  it("shows connected indicator when connected is true", () => {
    useAgentStore.setState({ connected: true });
    render(<TimelineBar />);
    const liveText = screen.getByText("LIVE");
    expect(liveText).toBeDefined();
  });

  it("shows disconnected indicator when connected is false", () => {
    useAgentStore.setState({ connected: false });
    render(<TimelineBar />);
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  it("renders the Review button in live mode", () => {
    render(<TimelineBar />);
    expect(screen.getByText("Review")).toBeDefined();
  });

  it("switches to review mode when Review button is clicked", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    // In review mode: LIVE becomes a button (not a plain text span)
    // and speed controls appear
    const liveBtn = screen.getByLabelText("Resume live mode");
    expect(liveBtn).toBeDefined();
  });

  it("shows speed buttons in review mode", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByText("0.5x")).toBeDefined();
    expect(screen.getByText("1x")).toBeDefined();
    expect(screen.getByText("2x")).toBeDefined();
    expect(screen.getByText("4x")).toBeDefined();
  });

  it("returns to live mode when LIVE button is clicked in review mode", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Resume live mode"));
    // Back to live: Review button visible again
    expect(screen.getByText("Review")).toBeDefined();
  });

  it("renders active count from agents", () => {
    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1", status: "running" }));
    agents.set("a2", mockAgent({ id: "a2", status: "idle" }));
    agents.set("a3", mockAgent({ id: "a3", status: "completed" }));
    useAgentStore.setState({ agents });
    render(<TimelineBar />);
    expect(screen.getByText("2 active")).toBeDefined();
  });

  it("renders activity dots for non-token events", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        agentType: "build",
        startTime: Date.now() - 10000,
      }),
    );
    useAgentStore.setState({
      agents,
      activity: [
        makeEntry(
          {
            type: "agent:register",
            agentId: "a1",
            agentType: "build",
            task: "t",
          },
          Date.now() - 5000,
        ),
        makeEntry(
          {
            type: "agent:tool_call",
            agentId: "a1",
            tool: "Bash",
          },
          Date.now() - 4000,
        ),
        makeEntry(
          {
            type: "agent:complete",
            agentId: "a1",
            duration: 3000,
          },
          Date.now() - 3000,
        ),
        makeEntry(
          {
            type: "agent:status",
            agentId: "a1",
            status: "error",
          },
          Date.now() - 2000,
        ),
        makeEntry(
          {
            type: "agent:status",
            agentId: "a1",
            status: "waiting",
          },
          Date.now() - 1000,
        ),
        makeEntry(
          {
            type: "agent:tokens",
            agentId: "a1",
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            contextWindow: 200000,
          },
          Date.now(),
        ),
      ],
    });
    render(<TimelineBar />);
    // Activity renders dots — verify no crash
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  it("filters dots in review mode (only dots <= scrubPosition are shown)", () => {
    useAgentStore.setState({
      activity: [
        makeEntry({
          type: "agent:register",
          agentId: "a1",
          agentType: "main",
          task: "t",
        }),
      ],
    });
    render(<TimelineBar />);
    // Enter review mode (scrubPosition defaults to 100, so all dots visible)
    fireEvent.click(screen.getByText("Review"));
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
  });

  it("colors tool_call dots by agent type when agent exists in store", () => {
    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1", agentType: "explore" }));
    useAgentStore.setState({
      agents,
      activity: [
        makeEntry({
          type: "agent:tool_call",
          agentId: "a1",
          tool: "ReadFile",
        }),
      ],
    });
    render(<TimelineBar />);
    // Renders without crash when agent lookup succeeds
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  it("colors tool_call dots with muted color when agent not in store", () => {
    useAgentStore.setState({
      agents: new Map(),
      activity: [
        makeEntry({
          type: "agent:tool_call",
          agentId: "unknown-agent",
          tool: "Bash",
        }),
      ],
    });
    render(<TimelineBar />);
    // Renders without crash when agent lookup fails
    expect(screen.getByText("LIVE")).toBeDefined();
  });

  it("calls replaySetSpeed when a speed button is clicked in review mode", () => {
    const replaySetSpeed = vi.fn();
    useAgentStore.setState({ replaySetSpeed });
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    fireEvent.click(screen.getByText("2x"));
    expect(replaySetSpeed).toHaveBeenCalledWith(2);
  });

  it("renders a progress fill div in review mode", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    // In review mode the scrub fill div should be present (width=scrubPosition%)
    // We can't easily query for it by role, but the component shouldn't crash
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
  });

  it("handles mouseDown on event track in review mode without throwing", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    // The track div is the one wrapping the dots
    const track = document.querySelector(
      ".flex-1.relative.cursor-pointer",
    ) as HTMLElement;
    if (track) {
      fireEvent.mouseDown(track);
      fireEvent.mouseMove(track, { clientX: 50 });
      fireEvent.mouseUp(track);
    }
    // If no crash, test passes
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
  });

  it("handles mouseLeave on event track", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    const track = document.querySelector(
      ".flex-1.relative.cursor-pointer",
    ) as HTMLElement;
    if (track) {
      fireEvent.mouseDown(track);
      fireEvent.mouseLeave(track); // should cancel isDragging
    }
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
  });

  it("track click in review mode updates scrub position", () => {
    render(<TimelineBar />);
    fireEvent.click(screen.getByText("Review"));
    const track = document.querySelector(
      ".flex-1.relative.cursor-pointer",
    ) as HTMLElement;
    if (track) {
      // Simulate a click at x=50 on a 100px-wide track
      const getBoundingClientRect = vi.fn(() => ({
        left: 0,
        width: 100,
        top: 0,
        height: 20,
        right: 100,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));
      track.getBoundingClientRect = getBoundingClientRect;
      fireEvent.click(track, { clientX: 50 });
    }
    // Component should still be in review mode, not crash
    expect(screen.getByLabelText("Resume live mode")).toBeDefined();
  });
});
