import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { UsagePanel } from "../UsagePanel";
import { mockAgent } from "@/lib/__tests__/test-utils";

// The component uses useApiUsage which is a singleton. We mock the module so
// we can inject controlled apiUsage data without triggering the real poller.
vi.mock("@/hooks/useApiUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useApiUsage")>();
  return {
    ...actual,
    useApiUsage: vi.fn().mockReturnValue({ data: null, error: false }),
  };
});

import { useApiUsage } from "@/hooks/useApiUsage";

describe("UsagePanel", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: new Map() });
    vi.mocked(useApiUsage).mockReturnValue({ data: null, error: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── empty state ─────────────────────────────────────────────────────────

  it("renders nothing when agents is empty and no apiUsage", () => {
    const { container } = render(<UsagePanel />);
    expect(container.innerHTML).toBe("");
  });

  // ── with agents only ────────────────────────────────────────────────────

  it("renders the Usage heading when agents are present", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({ id: "a1", inputTokens: 1000, outputTokens: 500 }),
    );
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Usage")).toBeDefined();
  });

  it("renders Context label and token counts", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        inputTokens: 10000,
        outputTokens: 5000,
        contextWindow: 200000,
      }),
    );
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Context")).toBeDefined();
  });

  it("renders Tokens and Cost rows", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        inputTokens: 1000,
        outputTokens: 500,
        contextWindow: 200000,
      }),
    );
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Tokens")).toBeDefined();
    expect(screen.getByText("Cost")).toBeDefined();
  });

  it("renders Runtime row", () => {
    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1", startTime: Date.now() - 60000 }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Runtime")).toBeDefined();
  });

  it("shows context usage percentage", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        inputTokens: 50000,
        outputTokens: 50000,
        contextWindow: 200000,
      }),
    );
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    // 100000/200000 = 50%
    expect(screen.getByText("50.0%")).toBeDefined();
  });

  it("caps context percent display at 100%", () => {
    const agents = new Map();
    agents.set(
      "a1",
      mockAgent({
        id: "a1",
        inputTokens: 300000,
        outputTokens: 0,
        contextWindow: 100000,
      }),
    );
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    // 300000/100000 = 300% but capped at 100%
    expect(screen.getByText("100.0%")).toBeDefined();
  });

  // ── apiUsage data paths ────────────────────────────────────────────────

  it("renders session and weekly usage bars when apiUsage data is present", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 45,
        weeklyPercent: 70,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });

    // Needs at least one agent or apiUsage to not return null
    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Session")).toBeDefined();
    expect(screen.getByText("Weekly")).toBeDefined();
  });

  it("shows usage bars without agents when apiUsage data is present", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 30,
        weeklyPercent: 55,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    // agents is empty — panel still renders because apiUsage is present
    render(<UsagePanel />);
    expect(screen.getByText("Usage")).toBeDefined();
    expect(screen.getByText("Session")).toBeDefined();
    expect(screen.getByText("Weekly")).toBeDefined();
  });

  it("shows stale warning when apiUsage.stale is true", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 50,
        weeklyPercent: 60,
        blockResetAt: null,
        weeklyResetAt: null,
        stale: true,
        ageMs: 5 * 60 * 1000, // 5 minutes
      },
      error: false,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText(/Stale/)).toBeDefined();
  });

  it("shows stale age in minutes format (< 60 min)", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 50,
        weeklyPercent: 60,
        blockResetAt: null,
        weeklyResetAt: null,
        stale: true,
        ageMs: 15 * 60 * 1000, // 15 minutes
      },
      error: false,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    // formatAge(15 * 60 * 1000) = "15m"
    expect(screen.getByText(/15m old/)).toBeDefined();
  });

  it("shows stale age in hours format (>= 60 min, < 24h)", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 50,
        weeklyPercent: 60,
        blockResetAt: null,
        weeklyResetAt: null,
        stale: true,
        ageMs: 2 * 60 * 60 * 1000, // 2 hours
      },
      error: false,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    // formatAge(2 * 60 * 60 * 1000) = "2h"
    expect(screen.getByText(/2h old/)).toBeDefined();
  });

  it("shows stale age in days format (>= 24h)", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 50,
        weeklyPercent: 60,
        blockResetAt: null,
        weeklyResetAt: null,
        stale: true,
        ageMs: 2 * 24 * 60 * 60 * 1000, // 2 days
      },
      error: false,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    // formatAge(2 * 24 * 60 * 60 * 1000) = "2d"
    expect(screen.getByText(/2d old/)).toBeDefined();
  });

  it("shows 'Usage data unavailable' when error is true and no data", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: null,
      error: true,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.getByText("Usage data unavailable")).toBeDefined();
  });

  it("does not show stale warning when apiUsage.stale is false", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 40,
        weeklyPercent: 50,
        blockResetAt: null,
        weeklyResetAt: null,
        stale: false,
      },
      error: false,
    });

    const agents = new Map();
    agents.set("a1", mockAgent({ id: "a1" }));
    useAgentStore.setState({ agents });
    render(<UsagePanel />);
    expect(screen.queryByText(/Stale/)).toBeNull();
  });
});
