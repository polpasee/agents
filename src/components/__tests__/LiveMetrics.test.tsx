import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";

// LiveMetrics imports from individual d3 sub-packages; mock each one.
// All factories use only inline vi.fn() — variables are not accessible here due to hoisting.
vi.mock("d3-array", () => ({
  max: vi.fn(() => 10),
}));

vi.mock("d3-scale", () => ({
  scaleLinear: vi.fn(() => ({
    domain: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnValue(vi.fn(() => 0)),
  })),
}));

vi.mock("d3-shape", () => ({
  line: vi.fn(() => ({
    x: vi.fn().mockReturnThis(),
    y: vi.fn().mockReturnThis(),
    curve: vi.fn().mockReturnValue(vi.fn(() => "M0,0")),
  })),
  area: vi.fn(() => ({
    x: vi.fn().mockReturnThis(),
    y0: vi.fn().mockReturnThis(),
    y1: vi.fn().mockReturnThis(),
    curve: vi.fn().mockReturnValue(vi.fn(() => "M0,0")),
  })),
  curveMonotoneX: {},
}));

vi.mock("d3-selection", () => ({
  select: vi.fn(() => ({
    select: vi.fn(() => ({
      empty: vi.fn(() => true),
      datum: vi.fn().mockReturnThis(),
      attr: vi.fn().mockReturnThis(),
    })),
    append: vi.fn(() => ({
      attr: vi.fn().mockReturnThis(),
      datum: vi.fn().mockReturnThis(),
    })),
  })),
}));

import { LiveMetrics } from "../LiveMetrics";
import { select as d3select } from "d3-selection";
import type { MetricSample } from "@/lib/types";

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    activeCount: 2,
    tokensPerSec: 100,
    totalCost: 0.05,
    costPerMin: 0.001,
    totalTokens: 5000,
    ...overrides,
  };
}

describe("LiveMetrics", () => {
  beforeEach(() => {
    useAgentStore.setState({
      showLiveMetrics: false,
      metricHistory: [],
      toggleLiveMetrics: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when showLiveMetrics is false", () => {
    const { container } = render(<LiveMetrics />);
    expect(container.innerHTML).toBe("");
  });

  it("renders LIVE METRICS heading when showLiveMetrics is true", () => {
    useAgentStore.setState({ showLiveMetrics: true });
    render(<LiveMetrics />);
    expect(screen.getByText("LIVE METRICS")).toBeDefined();
  });

  it("renders all metric labels", () => {
    useAgentStore.setState({ showLiveMetrics: true });
    render(<LiveMetrics />);
    expect(screen.getByText("ACTIVE")).toBeDefined();
    expect(screen.getByText("TOKENS")).toBeDefined();
    expect(screen.getByText("COST")).toBeDefined();
    expect(screen.getByText("$/MIN")).toBeDefined();
  });

  it("shows zero values when metricHistory is empty", () => {
    useAgentStore.setState({ showLiveMetrics: true, metricHistory: [] });
    render(<LiveMetrics />);
    // activeCount=0 → "0"
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  it("renders current values from latest metricHistory sample", () => {
    const sample = makeSample({
      activeCount: 3,
      tokensPerSec: 1500,
      totalCost: 0.25,
      costPerMin: 0.05,
    });
    useAgentStore.setState({
      showLiveMetrics: true,
      metricHistory: [sample],
    });
    render(<LiveMetrics />);
    // activeCount=3
    expect(screen.getByText("3")).toBeDefined();
    // tokensPerSec=1500 → "1.5K"
    expect(screen.getByText("1.5K")).toBeDefined();
    // costPerMin=0.05 → "$0.050"
    expect(screen.getByText("$0.050")).toBeDefined();
  });

  it("formats large tokensPerSec values with M suffix", () => {
    const sample = makeSample({ tokensPerSec: 2_500_000 });
    useAgentStore.setState({
      showLiveMetrics: true,
      metricHistory: [sample],
    });
    render(<LiveMetrics />);
    expect(screen.getByText("2.5M")).toBeDefined();
  });

  it("shows <$0.01 for costPerMin below threshold", () => {
    const sample = makeSample({ costPerMin: 0.005 });
    useAgentStore.setState({
      showLiveMetrics: true,
      metricHistory: [sample],
    });
    render(<LiveMetrics />);
    expect(screen.getByText("<$0.01")).toBeDefined();
  });

  it("renders sparkline SVG elements for each metric", () => {
    useAgentStore.setState({ showLiveMetrics: true, metricHistory: [] });
    render(<LiveMetrics />);
    // 4 SVG elements (one sparkline per METRICS entry)
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBe(4);
  });

  it("calls toggleLiveMetrics when CLOSE button is clicked", () => {
    const toggleLiveMetrics = vi.fn();
    useAgentStore.setState({ showLiveMetrics: true, toggleLiveMetrics });
    render(<LiveMetrics />);
    fireEvent.click(screen.getByText("CLOSE"));
    expect(toggleLiveMetrics).toHaveBeenCalledOnce();
  });

  it("triggers D3 sparkline effect when data is present", () => {
    const samples = [
      makeSample({ activeCount: 1, tokensPerSec: 10 }),
      makeSample({ activeCount: 2, tokensPerSec: 20 }),
      makeSample({ activeCount: 3, tokensPerSec: 30 }),
    ];
    useAgentStore.setState({
      showLiveMetrics: true,
      metricHistory: samples,
    });
    render(<LiveMetrics />);
    // d3-selection.select() should have been called for each Sparkline
    expect(vi.mocked(d3select)).toHaveBeenCalled();
  });
});
