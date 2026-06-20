import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ReplayBar } from "../ReplayBar";
import type { ReplayState } from "@/lib/types";

function makeReplayState(overrides: Partial<ReplayState> = {}): ReplayState {
  return {
    active: true,
    playing: false,
    speed: 1,
    currentIndex: 3,
    currentTime: 1000,
    startTime: 0,
    endTime: 5000,
    session: {
      startTime: 0,
      events: [
        {
          timestamp: 0,
          event: {
            type: "agent:register",
            agentId: "a1",
            agentType: "main",
            task: "t",
          },
        },
        {
          timestamp: 1000,
          event: {
            type: "agent:register",
            agentId: "a2",
            agentType: "build",
            task: "t",
          },
        },
        {
          timestamp: 2000,
          event: { type: "agent:complete", agentId: "a1", duration: 2000 },
        },
        {
          timestamp: 3000,
          event: { type: "agent:complete", agentId: "a2", duration: 1000 },
        },
        {
          timestamp: 4000,
          event: { type: "agent:status", agentId: "a1", status: "idle" },
        },
      ],
    },
    ...overrides,
  };
}

function setupReplay(overrides: Partial<ReplayState> = {}) {
  const replayPlay = vi.fn();
  const replayPause = vi.fn();
  const replaySeek = vi.fn();
  const replaySetSpeed = vi.fn();
  const replayExit = vi.fn();
  useAgentStore.setState({
    replay: makeReplayState(overrides),
    replayPlay,
    replayPause,
    replaySeek,
    replaySetSpeed,
    replayExit,
  });
  return { replayPlay, replayPause, replaySeek, replaySetSpeed, replayExit };
}

describe("ReplayBar", () => {
  beforeEach(() => {
    useAgentStore.setState({
      replay: {
        active: false,
        playing: false,
        speed: 1,
        currentIndex: 0,
        currentTime: 0,
        startTime: 0,
        endTime: 0,
        session: null,
      },
    });
  });

  it("renders nothing when replay is not active", () => {
    const { container } = render(<ReplayBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when replay.session is null", () => {
    useAgentStore.setState({
      replay: makeReplayState({ session: null }),
    });
    const { container } = render(<ReplayBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the play button when not playing", () => {
    setupReplay({ playing: false });
    render(<ReplayBar />);
    const btn = screen.getByTitle("Play");
    expect(btn).toBeDefined();
  });

  it("renders the pause button when playing", () => {
    setupReplay({ playing: true });
    render(<ReplayBar />);
    const btn = screen.getByTitle("Pause");
    expect(btn).toBeDefined();
  });

  it("calls replayPlay when play button is clicked", () => {
    const { replayPlay } = setupReplay({ playing: false });
    render(<ReplayBar />);
    fireEvent.click(screen.getByTitle("Play"));
    expect(replayPlay).toHaveBeenCalledTimes(1);
  });

  it("calls replayPause when pause button is clicked", () => {
    const { replayPause } = setupReplay({ playing: true });
    render(<ReplayBar />);
    fireEvent.click(screen.getByTitle("Pause"));
    expect(replayPause).toHaveBeenCalledTimes(1);
  });

  it("calls replayExit when exit button is clicked", () => {
    const { replayExit } = setupReplay();
    render(<ReplayBar />);
    fireEvent.click(screen.getByTitle("Exit replay"));
    expect(replayExit).toHaveBeenCalledTimes(1);
  });

  it("renders all four speed buttons", () => {
    setupReplay();
    render(<ReplayBar />);
    expect(screen.getByText("0.5x")).toBeDefined();
    expect(screen.getByText("1x")).toBeDefined();
    expect(screen.getByText("2x")).toBeDefined();
    expect(screen.getByText("4x")).toBeDefined();
  });

  it("calls replaySetSpeed with the chosen speed", () => {
    const { replaySetSpeed } = setupReplay({ speed: 1 });
    render(<ReplayBar />);
    fireEvent.click(screen.getByText("2x"));
    expect(replaySetSpeed).toHaveBeenCalledWith(2);
  });

  it("highlights the current speed button", () => {
    setupReplay({ speed: 2 });
    render(<ReplayBar />);
    // The current speed (2) button has a highlighted background;
    // we check its style differs from others (color: '#000' vs secondary)
    const btn2x = screen.getByText("2x");
    expect(btn2x.style.color).toBe("rgb(0, 0, 0)");
  });

  it("renders the progress range slider", () => {
    setupReplay({ startTime: 0, endTime: 5000, currentTime: 1000 });
    render(<ReplayBar />);
    const slider = screen.getByRole("slider");
    expect(slider).toBeDefined();
    expect((slider as HTMLInputElement).value).toBe("1000");
  });

  it("calls replaySeek on slider change", () => {
    const { replaySeek } = setupReplay({ startTime: 0, endTime: 5000 });
    render(<ReplayBar />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2500" } });
    expect(replaySeek).toHaveBeenCalledWith(2500);
  });

  it("shows event counter as 'Event <currentIndex> / <total>'", () => {
    setupReplay({ currentIndex: 3, session: makeReplayState().session! });
    render(<ReplayBar />);
    // total events = 5 from makeReplayState
    expect(screen.getByText(/Event 3 \/ 5/)).toBeDefined();
  });
});
