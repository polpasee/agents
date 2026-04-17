import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockOpenSync = vi.fn();
const mockReadSync = vi.fn();
const mockCloseSync = vi.fn();

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  readSync: (...args: unknown[]) => mockReadSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
}));

vi.mock("../file-reader", () => ({
  readNewLines: vi.fn().mockReturnValue([]),
  extractTaskFromJSONL: vi.fn().mockReturnValue({
    task: "test task",
    slug: "test-slug",
    model: "claude-sonnet-4-20250514",
    startTime: Date.now(),
  }),
  cleanupFileOffsets: vi.fn(),
}));

vi.mock("../agent-state", () => ({
  agents: new Map(),
  edges: [],
  teams: new Map(),
  agentLastModified: new Map(),
  removedAgentIds: new Map(),
  agentFilePaths: new Map(),
  registerAgent: vi.fn(),
  updateAgentStatus: vi.fn(),
  processEntry: vi.fn(),
  parseAgentType: vi.fn().mockReturnValue("generic"),
  broadcast: vi.fn(),
}));

import { discoverActiveSessions, selectStaleAgentIds } from "../discovery";
import { STALE_THRESHOLD_MS } from "../config";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("discoverActiveSessions", () => {
  it("is exported as a function", () => {
    expect(typeof discoverActiveSessions).toBe("function");
  });

  it("can be imported without error", () => {
    expect(discoverActiveSessions).toBeDefined();
  });

  it("returns early when projects directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => discoverActiveSessions("/nonexistent")).not.toThrow();
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });

  it("handles an empty projects directory", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);

    expect(() => discoverActiveSessions("/projects")).not.toThrow();
  });
});

describe("selectStaleAgentIds", () => {
  const old = -STALE_THRESHOLD_MS - 60_000; // well past threshold
  const fresh = -60_000; // within threshold

  it("purges a main agent whose file is beyond the stale window", () => {
    const now = Date.now();
    const agents = new Map([
      ["main", { status: "idle", startTime: now + old }],
    ]);
    const mtimes = new Map([["main", now + old]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["main"]);
  });

  it("protects a stale main while any sub-agent is still fresh", () => {
    const now = Date.now();
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "running", startTime: now + fresh }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + fresh],
    ]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("still purges a stale main whose sub has also gone stale", () => {
    const now = Date.now();
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "idle", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + old],
    ]);

    expect(selectStaleAgentIds(agents, mtimes, now).sort()).toEqual(["main", "sub"]);
  });

  it("purges stale sub-agents regardless of parent state", () => {
    const now = Date.now();
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "running", startTime: now + fresh }],
      ["sub", { parentId: "main", status: "idle", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + fresh],
      ["sub", now + old],
    ]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["sub"]);
  });

  it("ignores agents that are completed or errored", () => {
    const now = Date.now();
    const agents = new Map([
      ["done", { status: "completed", startTime: now + old }],
      ["err", { status: "error", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["done", now + old],
      ["err", now + old],
    ]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });
});
