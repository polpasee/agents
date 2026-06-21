/**
 * Additional ExportModal behavior tests — export content generation
 * and format switching interactions.
 *
 * Strategy: stub `URL.createObjectURL` and intercept the Blob constructor
 * via globalThis.Blob replacement so we can capture the exported content
 * without real file downloads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAgentStore } from "@/lib/store";
import { ExportModal } from "../ExportModal";
import { mockAgent } from "@/lib/__tests__/test-utils";

// ── Capture helpers ────────────────────────────────────────────────────────

let capturedContent = "";
let capturedMimeType = "";
let capturedFilename = "";

class FakeBlob {
  private _content: string;
  type: string;

  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    // Collect all string parts
    this._content = (parts as string[]).join("");
    capturedContent = this._content;
    capturedMimeType = options?.type ?? "";
    this.type = options?.type ?? "";
  }

  text() {
    return Promise.resolve(this._content);
  }

  get size() {
    return this._content.length;
  }
}

// ── Setup / teardown ───────────────────────────────────────────────────────

function setupAgentsAndModal() {
  const agents = new Map();
  agents.set(
    "a1",
    mockAgent({
      id: "a1",
      agentType: "main",
      status: "completed",
      task: "implement feature",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheCreateTokens: 50,
      duration: 30000,
    }),
  );
  agents.set(
    "a2",
    mockAgent({
      id: "a2",
      agentType: "build",
      status: "running",
      task: "build module",
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    }),
  );
  useAgentStore.setState({ showExportModal: true, agents });
}

beforeEach(() => {
  capturedContent = "";
  capturedMimeType = "";
  capturedFilename = "";

  // Replace global Blob with our fake
  vi.stubGlobal("Blob", FakeBlob);

  // Stub URL methods to prevent real download
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  // Stub document.createElement to capture the download attribute on <a>
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "a") {
      // Override the click and capture the download attribute set via a.download = ...
      let _download = "";
      Object.defineProperty(el, "download", {
        get: () => _download,
        set: (v: string) => {
          _download = v;
          capturedFilename = v;
        },
        configurable: true,
      });
      vi.spyOn(el, "click").mockImplementation(() => {});
    }
    return el;
  });

  setupAgentsAndModal();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── JSON export ────────────────────────────────────────────────────────────

describe("ExportModal — JSON export", () => {
  it("produces valid JSON containing agent data", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("JSON"));

    const parsed = JSON.parse(capturedContent) as {
      agents: Array<{ id: string }>;
      summary: string;
    };
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.length).toBe(2);
    expect(parsed.summary).toContain("2 agents total");
  });

  it("sets application/json MIME type", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("JSON"));
    expect(capturedMimeType).toBe("application/json");
  });

  it("filename starts with 'agent-report-' and ends with '.json'", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("JSON"));
    expect(capturedFilename).toMatch(/^agent-report-.+\.json$/);
  });

  it("closes the modal after export", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("JSON"));
    expect(useAgentStore.getState().showExportModal).toBe(false);
  });

  it("JSON report contains generatedAt timestamp", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("JSON"));
    const parsed = JSON.parse(capturedContent) as { generatedAt: number };
    expect(typeof parsed.generatedAt).toBe("number");
  });
});

// ── CSV export ─────────────────────────────────────────────────────────────

describe("ExportModal — CSV export", () => {
  it("produces CSV with the correct header row", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    const firstLine = capturedContent.split("\n")[0];
    expect(firstLine).toBe("id,type,status,tokens,cost,duration,task");
  });

  it("produces one data row per agent", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    const lines = capturedContent.split("\n").filter(Boolean);
    expect(lines.length).toBe(3); // header + 2 agents
  });

  it("agent ids appear in the CSV rows", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    expect(capturedContent).toContain("a1");
    expect(capturedContent).toContain("a2");
  });

  it("sets text/csv MIME type", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    expect(capturedMimeType).toBe("text/csv");
  });

  it("filename ends with .csv", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    expect(capturedFilename).toMatch(/\.csv$/);
  });

  it("closes the modal after export", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("CSV"));
    expect(useAgentStore.getState().showExportModal).toBe(false);
  });
});

// ── Markdown export ────────────────────────────────────────────────────────

describe("ExportModal — Markdown export", () => {
  it("starts with a level-1 heading", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(capturedContent).toMatch(/^# Agent Monitor Report/);
  });

  it("contains a Summary section", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(capturedContent).toContain("## Summary");
    expect(capturedContent).toContain("2 agents total");
  });

  it("contains an Agents table section", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(capturedContent).toContain("## Agents");
    expect(capturedContent).toContain("| ID | Type | Status");
  });

  it("sets text/markdown MIME type", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(capturedMimeType).toBe("text/markdown");
  });

  it("filename ends with .md", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(capturedFilename).toMatch(/\.md$/);
  });

  it("closes the modal after export", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("Markdown"));
    expect(useAgentStore.getState().showExportModal).toBe(false);
  });
});

// ── Modal controls ─────────────────────────────────────────────────────────

describe("ExportModal — modal controls", () => {
  it("ESC button closes the modal without exporting", () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText("ESC"));
    expect(useAgentStore.getState().showExportModal).toBe(false);
    expect(capturedContent).toBe("");
  });
});
