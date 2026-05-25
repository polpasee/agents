import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { AgentDetail } from "../AgentDetail";
import type { AgentState } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("AgentDetail", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: new Map(),
      teams: new Map(),
      selectedAgentId: null,
      logEntries: new Map(),
      agentTypeBudgets: {},
      agentDiffs: new Map(),
      annotations: new Map(),
    });
  });

  it("shows placeholder when no agent is selected", () => {
    render(<AgentDetail />);
    expect(screen.getByText("Select an agent to inspect")).toBeDefined();
  });

  it("shows agent info when an agent is selected", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", task: "implement feature", model: "claude-3" }));

    useAgentStore.setState({ agents, selectedAgentId: "a1" });
    render(<AgentDetail />);

    expect(screen.getByText("implement feature")).toBeDefined();
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.getByText("claude-3")).toBeDefined();
  });

  // F4 — body.entries from /api/logs/[agentId] must be Array-validated before
  // it lands in the store. A non-array (e.g. null) MUST be ignored.
  describe("handleViewLog body.entries validation", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("does not pollute logEntries when /api/logs returns non-array entries", async () => {
      const agents = new Map<string, AgentState>();
      agents.set("a1", mockAgent({ id: "a1" }));
      useAgentStore.setState({ agents, selectedAgentId: "a1", logEntries: new Map() });

      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ entries: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }) as Response,
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      render(<AgentDetail />);
      fireEvent.click(screen.getByText("LOG"));

      // Flush the in-flight async fetch
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const state = useAgentStore.getState();
      expect(state.logEntries.has("a1")).toBe(false);
      expect(state.logLoading.has("a1")).toBe(false);
    });
  });
});
