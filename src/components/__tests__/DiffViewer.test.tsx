import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { DiffViewer } from "../DiffViewer";
import type { AgentState, FileModification } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("DiffViewer", () => {
  beforeEach(() => {
    useAgentStore.setState({
      diffViewerAgentId: null,
      agents: new Map(),
      agentDiffs: new Map(),
    });
  });

  it("returns null when no diffViewerAgentId", () => {
    const { container } = render(<DiffViewer />);
    expect(container.innerHTML).toBe("");
  });

  it("renders file list when diffViewerAgentId is set", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1" }));

    const diffs: FileModification[] = [
      { filePath: "src/index.ts", operation: "edit", timestamp: Date.now() },
      { filePath: "src/new-file.ts", operation: "create", timestamp: Date.now() },
    ];

    const agentDiffs = new Map<string, FileModification[]>();
    agentDiffs.set("a1", diffs);

    useAgentStore.setState({
      agents,
      agentDiffs,
      diffViewerAgentId: "a1",
    });

    render(<DiffViewer />);
    expect(screen.getByText("File Changes")).toBeDefined();
    expect(screen.getByText("src/index.ts")).toBeDefined();
    expect(screen.getByText("src/new-file.ts")).toBeDefined();
  });
});
