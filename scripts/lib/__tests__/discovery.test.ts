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

import { discoverActiveSessions, selectStaleAgentIds, selectLosingMains } from "../discovery";
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

  it("returns a main agent as stale when its file is beyond the stale window", () => {
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

  it("returns a stale main whose sub has also gone stale", () => {
    const now = Date.now();
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "idle", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + old],
    ]);

    const result = selectStaleAgentIds(agents, mtimes, now);
    expect(result.sort()).toEqual(["main", "sub"]);
  });

  it("returns stale sub-agents regardless of parent state", () => {
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
});

describe("selectLosingMains", () => {
  type MainShape = { parentId?: string; startTime: number; metadata?: Record<string, unknown> };
  const mkMain = (projectDir: string, startTime = 0): MainShape => ({
    startTime,
    metadata: { projectDir },
  });
  const mkSub = (parentId: string, startTime = 0): MainShape => ({
    parentId,
    startTime,
  });

  it("returns an empty list when every project has exactly one main", () => {
    const agents = new Map<string, MainShape>([
      ["main-a", mkMain("/proj-a")],
      ["main-b", mkMain("/proj-b")],
    ]);
    const mtimes = new Map<string, number>([
      ["main-a", 100],
      ["main-b", 200],
    ]);
    expect(selectLosingMains(agents, mtimes)).toEqual([]);
  });

  it("evicts the older main when two share a projectDir", () => {
    const agents = new Map<string, MainShape>([
      ["old", mkMain("/proj")],
      ["new", mkMain("/proj")],
    ]);
    const mtimes = new Map<string, number>([
      ["old", 100],
      ["new", 500],
    ]);
    const result = selectLosingMains(agents, mtimes);
    expect(result).toEqual(["old"]);
    expect(result).not.toContain("new");
  });

  it("cascades eviction to the losing main's sub-agents", () => {
    const agents = new Map<string, MainShape>([
      ["old", mkMain("/proj")],
      ["new", mkMain("/proj")],
      ["old-sub-1", mkSub("old")],
      ["old-sub-2", mkSub("old")],
      ["new-sub-1", mkSub("new")],
    ]);
    const mtimes = new Map<string, number>([
      ["old", 100],
      ["new", 500],
      ["old-sub-1", 150],
      ["old-sub-2", 160],
      ["new-sub-1", 600],
    ]);
    const result = selectLosingMains(agents, mtimes).sort();
    expect(result).toEqual(["old", "old-sub-1", "old-sub-2"]);
    expect(result).not.toContain("new");
    expect(result).not.toContain("new-sub-1");
  });

  it("treats mains in different projects independently", () => {
    const agents = new Map<string, MainShape>([
      ["main-a", mkMain("/proj-a")],
      ["main-b", mkMain("/proj-b")],
    ]);
    const mtimes = new Map<string, number>([
      ["main-a", 100],
      ["main-b", 100],
    ]);
    expect(selectLosingMains(agents, mtimes)).toEqual([]);
  });

  it("falls back to startTime when lastModified ties, then to lexical id order", () => {
    // mtimes tie → startTime tie-breaks: "z" wins because higher startTime.
    const agents1 = new Map<string, MainShape>([
      ["a", mkMain("/proj", 100)],
      ["z", mkMain("/proj", 500)],
    ]);
    const mtimes1 = new Map<string, number>([
      ["a", 1000],
      ["z", 1000],
    ]);
    expect(selectLosingMains(agents1, mtimes1)).toEqual(["a"]);

    // Everything ties → lexically greater id wins (descending), so "a" loses.
    const agents2 = new Map<string, MainShape>([
      ["a", mkMain("/proj", 100)],
      ["z", mkMain("/proj", 100)],
    ]);
    const mtimes2 = new Map<string, number>([
      ["a", 1000],
      ["z", 1000],
    ]);
    expect(selectLosingMains(agents2, mtimes2)).toEqual(["a"]);
  });

  it("keeps only the newest when three mains share a projectDir and cascades losers' descendants", () => {
    const agents = new Map<string, MainShape>([
      ["m1", mkMain("/proj")],
      ["m2", mkMain("/proj")],
      ["m3", mkMain("/proj")],
      ["m1-sub", mkSub("m1")],
      ["m2-sub", mkSub("m2")],
      ["m3-sub", mkSub("m3")],
    ]);
    const mtimes = new Map<string, number>([
      ["m1", 100],
      ["m2", 200],
      ["m3", 300],
      ["m1-sub", 110],
      ["m2-sub", 210],
      ["m3-sub", 310],
    ]);
    const result = selectLosingMains(agents, mtimes).sort();
    expect(result).toEqual(["m1", "m1-sub", "m2", "m2-sub"]);
    expect(result).not.toContain("m3");
    expect(result).not.toContain("m3-sub");
  });
});
