import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { mockAgent } from "@/lib/__tests__/test-utils";
import { TopBar } from "../TopBar";

describe("TopBar", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.setState({
      connected: false,
      agents: new Map(),
      selectedAgentId: null,
      selectedSessionIds: new Set(),
      sessionFilterInitialized: true,
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

  it("lists one option per main session and labels the default with the session count", () => {
    useAgentStore.setState({
      agents: new Map([
        ["m1", mockAgent({ id: "m1", agentType: "main", sessionId: "s1", metadata: { projectName: "ProjA" } })],
        ["m2", mockAgent({ id: "m2", agentType: "main", sessionId: "s2" })],
        ["sub", mockAgent({ id: "sub", agentType: "build", parentId: "m1" })],
      ]),
    });
    render(<TopBar />);
    expect(screen.getByText("All sessions (2)")).toBeDefined();
    expect(screen.getByRole("option", { name: "ProjA" })).toBeDefined();
  });

  it("filters the topology to one session without opening the detail panel", () => {
    useAgentStore.setState({
      agents: new Map([
        ["m1", mockAgent({ id: "m1", agentType: "main", sessionId: "s1" })],
        ["m2", mockAgent({ id: "m2", agentType: "main", sessionId: "s2" })],
      ]),
    });
    render(<TopBar />);
    fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "s1" } });

    const state = useAgentStore.getState();
    expect([...state.selectedSessionIds]).toEqual(["s1"]);
    // Selecting a session is a view filter, never an agent pick.
    expect(state.selectedAgentId).toBeNull();
  });

  it("clears the filter when 'All sessions' is chosen", () => {
    useAgentStore.setState({
      agents: new Map([
        ["m1", mockAgent({ id: "m1", agentType: "main", sessionId: "s1" })],
        ["m2", mockAgent({ id: "m2", agentType: "main", sessionId: "s2" })],
      ]),
      selectedSessionIds: new Set(["s1"]),
    });
    render(<TopBar />);
    const select = screen.getByLabelText("Filter sessions") as HTMLSelectElement;
    // Single active filter is reflected as the dropdown's value.
    expect(select.value).toBe("s1");

    fireEvent.change(select, { target: { value: "" } });
    expect(useAgentStore.getState().selectedSessionIds.size).toBe(0);
  });
});
