import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";

// Mock HeatmapControls since it may use D3
vi.mock("../HeatmapControls", () => ({
  HeatmapControls: () => <div data-testid="heatmap-controls">HeatmapControls</div>,
}));

import { GraphControls } from "../GraphControls";

describe("GraphControls", () => {
  beforeEach(() => {
    useAgentStore.setState({
      hiddenAgentTypes: new Set(),
      heatmapEnabled: false,
      graphLayout: "force",
    });
  });

  it("renders layout selector buttons", () => {
    render(<GraphControls onFitToView={() => {}} />);

    expect(screen.getByText("FORCE")).toBeDefined();
    expect(screen.getByText("TREE")).toBeDefined();
    expect(screen.getByText("RADIAL")).toBeDefined();
    expect(screen.getByText("HIER")).toBeDefined();
  });

  it("renders FIT and HEAT buttons", () => {
    render(<GraphControls onFitToView={() => {}} />);

    expect(screen.getByText("FIT")).toBeDefined();
    expect(screen.getByText("HEAT")).toBeDefined();
  });
});
