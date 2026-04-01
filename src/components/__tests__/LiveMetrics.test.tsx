import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";

// Mock d3 to avoid SVG rendering issues in jsdom
vi.mock("d3", () => ({
  scaleLinear: () => ({ domain: () => ({ range: () => () => 0 }) }),
  line: () => ({ x: () => ({ y: () => ({ curve: () => () => "" }) }) }),
  area: () => ({ x: () => ({ y0: () => ({ y1: () => ({ curve: () => () => "" }) }) }) }),
  curveMonotoneX: {},
  max: () => 1,
  select: () => ({
    selectAll: () => ({ remove: () => {} }),
    append: () => ({ datum: () => ({ attr: () => ({ attr: () => ({}) }) }) }),
  }),
}));

import { LiveMetrics } from "../LiveMetrics";

describe("LiveMetrics", () => {
  beforeEach(() => {
    useAgentStore.setState({
      showLiveMetrics: false,
      metricHistory: [],
    });
  });

  it("returns null when showLiveMetrics is false", () => {
    const { container } = render(<LiveMetrics />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when showLiveMetrics is true", () => {
    useAgentStore.setState({ showLiveMetrics: true });
    render(<LiveMetrics />);

    expect(screen.getByText("LIVE METRICS")).toBeDefined();
    expect(screen.getByText("ACTIVE")).toBeDefined();
    expect(screen.getByText("TOKENS")).toBeDefined();
    expect(screen.getByText("COST")).toBeDefined();
  });
});
