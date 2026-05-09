import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { TopBar } from "../TopBar";

describe("TopBar", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      connected: false,
      selectedSessionIds: new Set(),
      viewMode: "graph",
      recording: false,
      showLiveMetrics: false,
      theme: "dark",
      replay: {
        active: false,
        session: null,
        playing: false,
        speed: 1,
        currentIndex: 0,
        currentTime: 0,
        startTime: 0,
        endTime: 0,
      },
    });
  });

  it("shows DISCONNECTED when not connected", () => {
    useAgentStore.setState({ connected: false });
    render(<TopBar />);
    expect(screen.getByText("DISCONNECTED")).toBeDefined();
  });

  it("shows AGENT MONITOR title", () => {
    render(<TopBar />);
    expect(screen.getByText("AGENT MONITOR")).toBeDefined();
  });
});
