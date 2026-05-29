import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ExportModal, csvEscape } from "../ExportModal";

describe("csvEscape", () => {
  it("returns plain strings unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps a value containing a comma in double quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("doubles internal quotes and wraps in double quotes", () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("wraps a value containing a newline in double quotes", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("converts numbers to string without quoting when safe", () => {
    expect(csvEscape(42)).toBe("42");
  });
});

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
