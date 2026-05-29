import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn<(..._args: unknown[]) => Promise<string>>();
const mockStat = vi.fn<(..._args: unknown[]) => Promise<{ size: number }>>(() =>
  Promise.resolve({ size: 1024 })
);
const mockOpen = vi.fn();
const mockRead = vi.fn();
const mockClose = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (..._args: unknown[]) => mockReadFile(..._args),
  stat: (..._args: unknown[]) => mockStat(..._args),
  open: (..._args: unknown[]) => mockOpen(..._args),
}));

import { readAgentLog } from "../log-reader";

beforeEach(() => {
  vi.resetAllMocks();
  mockStat.mockResolvedValue({ size: 1024 });
});

describe("readAgentLog", () => {
  it("throws when file does not exist (ENOENT propagates to caller)", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));
    await expect(readAgentLog("/nonexistent.jsonl")).rejects.toThrow("ENOENT");
  });

  it("returns empty array for empty file", async () => {
    mockReadFile.mockResolvedValue("");
    const result = await readAgentLog("/empty.jsonl");
    expect(result).toEqual([]);
  });

  it("parses user messages from JSONL", async () => {
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "user",
          content: "Hello world",
        },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello world");
  });

  it("parses assistant messages from JSONL", async () => {
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I can help" }],
        },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("I can help");
  });

  it("parses tool_use blocks from assistant messages", async () => {
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-1", name: "Read", input: { file: "test.ts" } },
          ],
        },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].toolCalls![0].name).toBe("Read");
  });

  it("matches tool_result to pending tool call", async () => {
    const lines = [
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-1", name: "Read", input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:01Z",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "file contents here" },
          ],
        },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    const assistantEntry = result.find((e) => e.role === "assistant");
    expect(assistantEntry?.toolCalls?.[0].result).toBe("file contents here");
  });

  it("skips malformed JSON lines", async () => {
    const lines = [
      "not valid json",
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: { role: "user", content: "valid" },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("valid");
  });

  it("skips entries without type or message", async () => {
    const lines = [
      JSON.stringify({ foo: "bar" }),
      JSON.stringify({ type: "message" }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "ok" },
      }),
    ];
    mockReadFile.mockResolvedValue(lines.join("\n"));

    const result = await readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
  });

  it("rejects (throws) when fs.stat throws ENOENT — IO errors must propagate", async () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    mockStat.mockRejectedValue(err);
    await expect(readAgentLog("/nonexistent.jsonl")).rejects.toThrow("ENOENT");
  });

  it("rejects (throws) when fs.readFile throws EACCES — IO errors must propagate", async () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    mockReadFile.mockRejectedValue(err);
    await expect(readAgentLog("/forbidden.jsonl")).rejects.toThrow("EACCES");
  });
});
