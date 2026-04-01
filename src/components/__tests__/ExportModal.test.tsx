import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ExportModal } from "../ExportModal";

describe("ExportModal", () => {
  beforeEach(() => {
    useAgentStore.setState({
      showExportModal: false,
      agents: new Map(),
    });
  });

  it("returns null when showExportModal is false", () => {
    const { container } = render(<ExportModal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders export options when showExportModal is true", () => {
    useAgentStore.setState({ showExportModal: true });
    render(<ExportModal />);

    expect(screen.getByText("EXPORT REPORT")).toBeDefined();
    expect(screen.getByText("JSON")).toBeDefined();
    expect(screen.getByText("CSV")).toBeDefined();
    expect(screen.getByText("Markdown")).toBeDefined();
  });
});
