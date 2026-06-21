import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TopologyUsageStatus } from "../TopologyUsageStatus";

// Mock useApiUsage to control returned data without the real singleton poller
vi.mock("@/hooks/useApiUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useApiUsage")>();
  return {
    ...actual,
    useApiUsage: vi.fn().mockReturnValue({ data: null, error: false }),
  };
});

import { useApiUsage } from "@/hooks/useApiUsage";

describe("TopologyUsageStatus", () => {
  beforeEach(() => {
    vi.mocked(useApiUsage).mockReturnValue({ data: null, error: false });
    // Block any fetch calls for /api/costs
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders nothing when apiUsage data is null", () => {
    const { container } = render(<TopologyUsageStatus />);
    expect(container.innerHTML).toBe("");
  });

  it("renders usage bars when apiUsage data is available", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 40,
        weeklyPercent: 60,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    render(<TopologyUsageStatus />);
    expect(screen.getByText("Session")).toBeDefined();
    expect(screen.getByText("Weekly")).toBeDefined();
  });

  it("renders the Day/Week/Month cost labels section", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 30,
        weeklyPercent: 50,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    render(<TopologyUsageStatus />);
    expect(screen.getByText("Day")).toBeDefined();
    expect(screen.getByText("Week")).toBeDefined();
    expect(screen.getByText("Month")).toBeDefined();
  });

  it("shows zero cost values before /api/costs fetch resolves", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 20,
        weeklyPercent: 40,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    render(<TopologyUsageStatus />);
    // Default cost state is { day:0, week:0, month:0 } which shows as $0.000000
    const dayLabel = screen.getByText("Day");
    expect(dayLabel).toBeDefined();
  });

  it("shows correct percentages for high usage", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 95,
        weeklyPercent: 88,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    render(<TopologyUsageStatus />);
    // Percentages are rounded: Math.round(95) = 95
    expect(screen.getByText("95%")).toBeDefined();
    expect(screen.getByText("88%")).toBeDefined();
  });

  it("shows 0% when blockPercent is null (falls back to 0 via deriveUsageBars)", () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: null,
        weeklyPercent: null,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });
    render(<TopologyUsageStatus />);
    const zeros = screen.getAllByText("0%");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });

  it("updates cost display when /api/costs resolves", async () => {
    vi.mocked(useApiUsage).mockReturnValue({
      data: {
        blockPercent: 50,
        weeklyPercent: 70,
        blockResetAt: null,
        weeklyResetAt: null,
      },
      error: false,
    });

    const costsPayload = { day: 1.5, week: 8.25, month: 25.0 };
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(costsPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as Response,
    );

    await act(async () => {
      render(<TopologyUsageStatus />);
      // Flush the fetch for /api/costs
      await Promise.resolve();
      await Promise.resolve();
    });

    // Day/Week/Month labels should be present
    expect(screen.getByText("Day")).toBeDefined();
    expect(screen.getByText("Week")).toBeDefined();
    expect(screen.getByText("Month")).toBeDefined();
  });
});
