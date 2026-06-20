import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { FileAttentionPanel } from "../FileAttentionPanel";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("FileAttentionPanel", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: new Map() });
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <FileAttentionPanel open={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the panel when open is true", () => {
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("File Attention")).toBeDefined();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<FileAttentionPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close file attention panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows 'No file activity yet' when no agents have tool calls", () => {
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("No file activity yet")).toBeDefined();
  });

  it("shows 'No file activity yet' when tool calls have no file_path or pattern", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [{ tool: "Bash", args: "ls -la", timestamp: 1 }],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("No file activity yet")).toBeDefined();
  });

  it("renders a file entry when an agent has a Read tool call with file_path", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [
          {
            tool: "Read",
            args: "file_path: /src/app/page.tsx",
            timestamp: 1,
          },
        ],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("app/page.tsx")).toBeDefined();
  });

  it("shows the summary footer with file count", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [
          { tool: "Read", args: "file_path: /src/foo.ts", timestamp: 1 },
        ],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("1 files tracked")).toBeDefined();
  });

  it("counts Read, Grep, Glob as reads and Edit, Write as edits", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [
          { tool: "Read", args: "file_path: /src/a.ts", timestamp: 1 },
          { tool: "Grep", args: "file_path: /src/a.ts", timestamp: 2 },
          { tool: "Edit", args: "file_path: /src/a.ts", timestamp: 3 },
        ],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("2 reads")).toBeDefined();
    expect(screen.getByText("1 edits")).toBeDefined();
  });

  it("aggregates tool calls across multiple agents for the same file", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [
          { tool: "Read", args: "file_path: /shared/util.ts", timestamp: 1 },
        ],
      }),
    );
    agents.set(
      "a2",
      mockAgent({
        id: "a2",
        toolCalls: [
          { tool: "Write", args: "file_path: /shared/util.ts", timestamp: 2 },
        ],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    expect(screen.getByText("1 reads")).toBeDefined();
    expect(screen.getByText("1 edits")).toBeDefined();
    expect(screen.getByText("1 files tracked")).toBeDefined();
  });

  it("sorts files by total access count descending", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [
          { tool: "Read", args: "file_path: /frequent.ts", timestamp: 1 },
          { tool: "Read", args: "file_path: /frequent.ts", timestamp: 2 },
          { tool: "Read", args: "file_path: /frequent.ts", timestamp: 3 },
          { tool: "Read", args: "file_path: /rare.ts", timestamp: 4 },
        ],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    const items = screen.getAllByTitle(/\.ts$/);
    // frequent.ts should come first (title shows full path)
    expect(items[0]?.getAttribute("title")).toContain("frequent.ts");
  });

  it("matches file path from pattern: args too", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        toolCalls: [{ tool: "Glob", args: "pattern: **/*.ts", timestamp: 1 }],
      }),
    );
    useAgentStore.setState({ agents });
    render(<FileAttentionPanel open={true} onClose={() => {}} />);
    // Should render the pattern as a file entry (not show the empty state)
    expect(screen.queryByText("No file activity yet")).toBeNull();
    // The extracted pattern path is shown
    expect(screen.getByText("1 files tracked")).toBeDefined();
  });
});
