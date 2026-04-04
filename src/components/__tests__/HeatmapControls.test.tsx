import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { HeatmapControls } from "../HeatmapControls";
import { resetStore } from "@/lib/__tests__/test-utils";

describe("HeatmapControls", () => {
  beforeEach(() => {
    resetStore();
  });

  it("renders the label and metric selector", () => {
    render(<HeatmapControls />);
    expect(screen.getByText("Heatmap Metric")).toBeDefined();
    expect(screen.getByRole("combobox")).toBeDefined();
  });

  it("displays all four metric options", () => {
    render(<HeatmapControls />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.textContent)).toEqual([
      "Idle Ratio",
      "Token Efficiency",
      "Time to First Tool",
      "Avg Tool Latency",
    ]);
  });

  it("reflects the current store metric as the selected value", () => {
    useAgentStore.setState({ heatmapMetric: "avgToolLatency" });
    render(<HeatmapControls />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("avgToolLatency");
  });

  it("updates the store when user selects a different metric", () => {
    render(<HeatmapControls />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "idleRatio" } });
    expect(useAgentStore.getState().heatmapMetric).toBe("idleRatio");
  });

  it("shows the first option value when metric matches it", () => {
    useAgentStore.setState({ heatmapMetric: "idleRatio" });
    render(<HeatmapControls />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("idleRatio");
  });
});
