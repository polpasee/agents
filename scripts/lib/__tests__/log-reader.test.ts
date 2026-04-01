import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFileSync = vi.fn();

vi.mock("fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { readAgentLog } from "../log-reader";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readAgentLog", () => {
  it("returns empty array when file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readAgentLog("/nonexistent.jsonl");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    mockReadFileSync.mockReturnValue("");
    const result = readAgentLog("/empty.jsonl");
    expect(result).toEqual([]);
  });

  it("parses user messages from JSONL", () => {
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
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello world");
  });

  it("parses assistant messages from JSONL", () => {
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
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("I can help");
  });

  it("parses tool_use blocks from assistant messages", () => {
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
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].toolCalls![0].name).toBe("Read");
  });

  it("matches tool_result to pending tool call", () => {
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
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    const assistantEntry = result.find((e) => e.role === "assistant");
    expect(assistantEntry?.toolCalls?.[0].result).toBe("file contents here");
  });

  it("skips malformed JSON lines", () => {
    const lines = [
      "not valid json",
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-01T00:00:00Z",
        message: { role: "user", content: "valid" },
      }),
    ];
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("valid");
  });

  it("skips entries without type or message", () => {
    const lines = [
      JSON.stringify({ foo: "bar" }),
      JSON.stringify({ type: "message" }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "ok" },
      }),
    ];
    mockReadFileSync.mockReturnValue(lines.join("\n"));

    const result = readAgentLog("/test.jsonl");
    expect(result).toHaveLength(1);
  });
});
