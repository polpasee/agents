import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStatSync = vi.fn();
const mockOpenSync = vi.fn();
const mockReadSync = vi.fn();
const mockCloseSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  readSync: (...args: unknown[]) => mockReadSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// Must import after vi.mock
import { readNewLines, extractTaskFromJSONL } from "../file-reader";

beforeEach(() => {
  vi.resetAllMocks();
});

function setupFileRead(content: string) {
  const buf = Buffer.from(content);
  mockStatSync.mockReturnValue({ size: buf.length });
  mockOpenSync.mockReturnValue(42);
  mockReadSync.mockImplementation((_fd: number, buffer: Buffer) => {
    buf.copy(buffer);
    return buf.length;
  });
  mockCloseSync.mockReturnValue(undefined);
}

describe("readNewLines", () => {
  it("returns empty array when stat fails", () => {
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readNewLines("/nonexistent.jsonl");
    expect(result).toEqual([]);
  });

  it("returns empty array when file has not grown", () => {
    mockStatSync.mockReturnValue({ size: 0 });
    const result = readNewLines("/empty.jsonl");
    expect(result).toEqual([]);
  });

  it("returns empty array when the file vanishes between stat and open", () => {
    mockStatSync.mockReturnValue({ size: 100 });
    mockOpenSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(readNewLines("/vanished-mid-read.jsonl")).toEqual([]);
  });

  it("reads new lines from a file", () => {
    const content = '{"line":1}\n{"line":2}\n';
    setupFileRead(content);

    const result = readNewLines("/test-new-lines.jsonl");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('{"line":1}');
    expect(result[1]).toBe('{"line":2}');
  });

  it("does not re-read already-read content on second call", () => {
    const content = '{"line":1}\n';
    setupFileRead(content);

    // First call reads content
    readNewLines("/tracked-file-test.jsonl");

    // Second call with same size returns empty
    const result = readNewLines("/tracked-file-test.jsonl");
    expect(result).toEqual([]);
  });
});

describe("extractTaskFromJSONL", () => {
  it("extracts task from string content", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      message: { role: "user", content: "Build a dashboard" },
    });
    setupFileRead(content);

    const result = extractTaskFromJSONL("/task-str.jsonl");
    expect(result.task).toBe("Build a dashboard");
  });

  it("extracts task from array content with text block", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Fix the bug" }],
      },
    });
    setupFileRead(content);

    const result = extractTaskFromJSONL("/task-arr.jsonl");
    expect(result.task).toBe("Fix the bug");
  });

  it("extracts model from message", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: "Hello",
      },
    });
    setupFileRead(content);

    const result = extractTaskFromJSONL("/model.jsonl");
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });

  it("extracts slug from entry", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      slug: "my-session",
      message: { role: "user", content: "Hello" },
    });
    setupFileRead(content);

    const result = extractTaskFromJSONL("/slug.jsonl");
    expect(result.slug).toBe("my-session");
  });

  it("strips XML tags from task text", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      message: {
        role: "user",
        content: "<command>Build</command> the <b>dashboard</b>",
      },
    });
    setupFileRead(content);

    const result = extractTaskFromJSONL("/tags.jsonl");
    expect(result.task).not.toContain("<");
    expect(result.task).toContain("Build");
    expect(result.task).toContain("dashboard");
  });

  it("returns empty result when file read fails", () => {
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = extractTaskFromJSONL("/missing.jsonl");
    expect(result.task).toBe("");
    expect(result.slug).toBe("");
    expect(result.model).toBe("");
  });
});
