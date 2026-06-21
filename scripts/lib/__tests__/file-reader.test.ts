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

  it("ignores stale buffer tail when readSync returns fewer bytes (short read)", () => {
    // stat reports a large file, but the read returns only the prefix; the
    // buffer tail keeps whatever Buffer.alloc zeroed it to. Decoding the whole
    // buffer would have leaked NUL bytes / a spurious empty line.
    const real = '{"line":1}\n{"line":2}\n';
    mockStatSync.mockReturnValue({ size: 4096 });
    mockOpenSync.mockReturnValue(42);
    mockCloseSync.mockReturnValue(undefined);
    mockReadSync.mockImplementation((_fd: number, buffer: Buffer) => {
      Buffer.from(real).copy(buffer);
      return Buffer.from(real).length; // short read: < buffer.length (4096)
    });

    const result = readNewLines("/short-read.jsonl");
    expect(result).toEqual(['{"line":1}', '{"line":2}']);
    // No NUL bytes from the zero-filled buffer tail leaked into the output.
    expect(result.join("")).not.toContain("\u0000");
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

  it("decodes only bytesRead on a short read (no stale tail contamination)", () => {
    const content = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      message: { role: "user", content: "Build a dashboard" },
    });
    const buf = Buffer.from(content);
    // chunk is allocated to min(stat.size, maxBytes); claim a larger file so
    // the chunk buffer is bigger than what readSync actually returns.
    mockStatSync.mockReturnValue({ size: buf.length + 2048 });
    mockOpenSync.mockReturnValue(42);
    mockCloseSync.mockReturnValue(undefined);
    mockReadSync.mockImplementation((_fd: number, buffer: Buffer) => {
      buf.copy(buffer);
      return buf.length; // short read: fewer than buffer.length
    });

    const result = extractTaskFromJSONL("/short-task.jsonl");
    // Without the bytesRead clamp the zero-filled tail would corrupt the line
    // and JSON.parse would skip it, yielding an empty task.
    expect(result.task).toBe("Build a dashboard");
  });
});

// ── EACCES / non-ENOENT error branches ───────────────────────────────────────

describe("readNewLines — EACCES error handling (branch 1 / branch 3)", () => {
  it("warns via console.warn when statSync throws EACCES (not silent)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    const result = readNewLines("/eacces-stat.jsonl");
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("Failed to stat");
    warnSpy.mockRestore();
  });

  it("does NOT warn when statSync throws ENOENT (silent path)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    });

    const result = readNewLines("/enoent-stat.jsonl");
    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns via console.warn when openSync throws EACCES (branch 3)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockReturnValue({ size: 100 });
    mockOpenSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    const result = readNewLines("/eacces-open.jsonl");
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("Failed to open");
    warnSpy.mockRestore();
  });

  it("does NOT warn when openSync throws ENOENT (silent path)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockReturnValue({ size: 100 });
    mockOpenSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    });

    const result = readNewLines("/enoent-open.jsonl");
    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("extractTaskFromJSONL — EACCES error handling (branch 17)", () => {
  it("warns via console.warn when statSync throws EACCES", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    const result = extractTaskFromJSONL("/eacces-extract.jsonl");
    expect(result.task).toBe("");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("Failed to extract task");
    warnSpy.mockRestore();
  });

  it("does NOT warn when statSync throws ENOENT (silent path)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = extractTaskFromJSONL("/enoent-extract.jsonl");
    expect(result.task).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
