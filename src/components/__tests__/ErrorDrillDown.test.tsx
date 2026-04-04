import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ErrorDrillDown } from "../ErrorDrillDown";
import type { AgentState, ErrorDetail } from "@/lib/types";
import { mockAgent } from "@/lib/__tests__/test-utils";

describe("ErrorDrillDown", () => {
  beforeEach(() => {
    useAgentStore.setState({
      errorDrillDownAgentId: null,
      agents: new Map(),
      errorDetails: new Map(),
    });
  });

  it("returns null when no errorDrillDownAgentId", () => {
    const { container } = render(<ErrorDrillDown />);
    expect(container.innerHTML).toBe("");
  });

  it("renders error info when errorDrillDownAgentId is set", () => {
    const agents = new Map<string, AgentState>();
    agents.set("a1", mockAgent({ id: "a1", task: "failing task" }));

    const errorDetails = new Map<string, ErrorDetail>();
    errorDetails.set("a1", {
      agentId: "a1",
      message: "Something broke badly",
      timestamp: Date.now(),
    });

    useAgentStore.setState({
      agents,
      errorDetails,
      errorDrillDownAgentId: "a1",
    });

    render(<ErrorDrillDown />);
    expect(screen.getByText("Error Details")).toBeDefined();
    expect(screen.getByText("Something broke badly")).toBeDefined();
    expect(screen.getByText("failing task")).toBeDefined();
  });
});
