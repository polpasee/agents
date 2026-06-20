import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { LogViewer } from "../LogViewer";
import type { LogEntry } from "@/lib/types";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: 1000,
    role: "user",
    content: "hello",
    ...overrides,
  };
}

function openViewer(agentId = "agent-1") {
  useAgentStore.setState({ logViewerAgentId: agentId });
}

describe("LogViewer", () => {
  beforeEach(() => {
    useAgentStore.setState({
      logViewerAgentId: null,
      logEntries: new Map(),
      logLoading: new Set(),
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── visibility ──────────────────────────────────────────────────────────

  it("renders nothing when logViewerAgentId is null", () => {
    const { container } = render(<LogViewer />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the modal when logViewerAgentId is set", () => {
    openViewer();
    render(<LogViewer />);
    expect(screen.getByText(/Agent Log:/)).toBeDefined();
  });

  // ── loading state ───────────────────────────────────────────────────────

  it("shows loading spinner when logLoading has the current agent", () => {
    useAgentStore.setState({
      logViewerAgentId: "agent-1",
      logLoading: new Set(["agent-1"]),
    });
    render(<LogViewer />);
    expect(screen.getByText("Loading log entries...")).toBeDefined();
  });

  // ── empty state ─────────────────────────────────────────────────────────

  it("shows empty state when no entries exist", () => {
    openViewer();
    render(<LogViewer />);
    expect(screen.getByText("No log entries available")).toBeDefined();
  });

  // ── close button ─────────────────────────────────────────────────────────

  it("calls closeLogViewer when the ✕ button is clicked", () => {
    openViewer();
    render(<LogViewer />);
    fireEvent.click(screen.getByText("✕"));
    expect(useAgentStore.getState().logViewerAgentId).toBeNull();
  });

  // ── content rendering ───────────────────────────────────────────────────

  it("renders a user message entry", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        ["a1", [makeEntry({ role: "user", content: "ping" })]],
      ]),
    });
    render(<LogViewer />);
    expect(screen.getByText("ping")).toBeDefined();
    expect(screen.getByText("user")).toBeDefined();
  });

  it("renders an assistant message entry", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        ["a1", [makeEntry({ role: "assistant", content: "pong response" })]],
      ]),
    });
    render(<LogViewer />);
    expect(screen.getByText("pong response")).toBeDefined();
    expect(screen.getByText("assistant")).toBeDefined();
  });

  it("renders a system message entry with a Copy button", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        ["a1", [makeEntry({ role: "system", content: "sys prompt" })]],
      ]),
    });
    render(<LogViewer />);
    expect(screen.getByText("sys prompt")).toBeDefined();
    expect(screen.getByText("Copy")).toBeDefined();
  });

  // ── tool calls ──────────────────────────────────────────────────────────

  it("renders a tool call toggle button (collapsed by default)", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({
              role: "assistant",
              content: "",
              toolCalls: [
                { id: "tc1", name: "ReadFile", input: '{"path":"foo"}' },
              ],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    expect(screen.getByText("ReadFile")).toBeDefined();
    // Input should not be visible until expanded
    expect(screen.queryByText("Input:")).toBeNull();
  });

  it("expands a tool call to show input when clicked", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({
              role: "assistant",
              content: "",
              toolCalls: [
                { id: "tc1", name: "ReadFile", input: '{"path":"bar"}' },
              ],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("ReadFile"));
    expect(screen.getByText("Input:")).toBeDefined();
    expect(screen.getByText('{"path":"bar"}')).toBeDefined();
  });

  it("shows result when tool call has a result and is expanded", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "tc2",
                  name: "Bash",
                  input: "ls",
                  result: "file.txt",
                },
              ],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("Bash"));
    expect(screen.getByText("Result:")).toBeDefined();
    expect(screen.getByText("file.txt")).toBeDefined();
  });

  it("collapses a tool call when clicked again", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({
              role: "assistant",
              content: "",
              toolCalls: [{ id: "tc3", name: "Write", input: "content" }],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("Write")); // expand
    expect(screen.getByText("Input:")).toBeDefined();
    fireEvent.click(screen.getByText("Write")); // collapse
    expect(screen.queryByText("Input:")).toBeNull();
  });

  // ── search filter ───────────────────────────────────────────────────────

  it("shows 'No matching entries' when search has no matches", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([["a1", [makeEntry({ content: "hello world" })]]]),
    });
    render(<LogViewer />);
    const input = screen.getByPlaceholderText("Search log entries...");
    fireEvent.change(input, { target: { value: "zzznomatch" } });
    expect(screen.getByText("No matching entries")).toBeDefined();
  });

  it("filters entries by search term in content", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({ content: "apple banana", timestamp: 1 }),
            makeEntry({ content: "cherry date", timestamp: 2 }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    const input = screen.getByPlaceholderText("Search log entries...");
    fireEvent.change(input, { target: { value: "apple" } });
    expect(screen.getByText("apple banana")).toBeDefined();
    expect(screen.queryByText("cherry date")).toBeNull();
  });

  it("filters entries by search term in tool call name", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({
              content: "",
              toolCalls: [{ id: "t1", name: "SearchFiles", input: "pattern" }],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.change(screen.getByPlaceholderText("Search log entries..."), {
      target: { value: "searchfiles" },
    });
    expect(screen.getByText("SearchFiles")).toBeDefined();
  });

  // ── role filter tabs ─────────────────────────────────────────────────────

  it("renders all five role filter tabs", () => {
    openViewer();
    render(<LogViewer />);
    expect(screen.getByText("All")).toBeDefined();
    expect(screen.getByText("System")).toBeDefined();
    expect(screen.getByText("User")).toBeDefined();
    expect(screen.getByText("Assistant")).toBeDefined();
    expect(screen.getByText("Tools")).toBeDefined();
  });

  it("filters by system role tab", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({ role: "user", content: "user msg" }),
            makeEntry({ role: "system", content: "sys msg" }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("System"));
    expect(screen.queryByText("user msg")).toBeNull();
    expect(screen.getByText("sys msg")).toBeDefined();
  });

  it("filters by tools tab (only entries with toolCalls)", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({ role: "user", content: "just text" }),
            makeEntry({
              role: "assistant",
              content: "has tool",
              toolCalls: [{ id: "t1", name: "SomeTool", input: "x" }],
            }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("Tools"));
    expect(screen.queryByText("just text")).toBeNull();
    expect(screen.getByText("SomeTool")).toBeDefined();
  });

  it("switches back to All tab to show all entries again", () => {
    useAgentStore.setState({
      logViewerAgentId: "a1",
      logEntries: new Map([
        [
          "a1",
          [
            makeEntry({ role: "user", content: "msg1" }),
            makeEntry({ role: "system", content: "msg2" }),
          ],
        ],
      ]),
    });
    render(<LogViewer />);
    fireEvent.click(screen.getByText("System"));
    expect(screen.queryByText("msg1")).toBeNull();
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("msg1")).toBeDefined();
    expect(screen.getByText("msg2")).toBeDefined();
  });
});
