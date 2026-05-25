import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../../scripts/lib/log-reader", () => ({
  readAgentLog: vi.fn(),
}));

vi.mock("../../../../../scripts/lib/agent-state", () => ({
  getAgentFilePath: vi.fn(),
}));

import { GET } from "../[agentId]/route";
import { readAgentLog } from "../../../../../scripts/lib/log-reader";
import { getAgentFilePath } from "../../../../../scripts/lib/agent-state";

const mockReadAgentLog = vi.mocked(readAgentLog);
const mockGetAgentFilePath = vi.mocked(getAgentFilePath);

function makeRequest(): Request {
  return new Request("http://localhost/api/logs/x");
}

describe("/api/logs/[agentId] GET", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 200 with entries when the agent has a file path", async () => {
    mockGetAgentFilePath.mockReturnValue("/fake/path.jsonl");
    mockReadAgentLog.mockResolvedValue([
      { timestamp: 1, role: "user", content: "hi" },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "main-x" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].content).toBe("hi");
  });

  it("returns 404 when the agent has no file path", async () => {
    mockGetAgentFilePath.mockReturnValue(undefined);

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "ghost" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 500 when readAgentLog throws", async () => {
    mockGetAgentFilePath.mockReturnValue("/fake/path.jsonl");
    mockReadAgentLog.mockRejectedValue(new Error("disk full"));

    const res = await GET(makeRequest(), { params: Promise.resolve({ agentId: "x" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/disk full/);
  });
});
