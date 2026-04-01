import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";

import { GraphControls } from "../GraphControls";

describe("GraphControls", () => {
  beforeEach(() => {
    useAgentStore.setState({
      graphLayout: "force",
    });
  });

  it("renders layout selector buttons", () => {
    render(<GraphControls />);

    expect(screen.getByText("FORCE")).toBeDefined();
    expect(screen.getByText("TREE")).toBeDefined();
    expect(screen.getByText("RADIAL")).toBeDefined();
    expect(screen.getByText("HIER")).toBeDefined();
  });
});
