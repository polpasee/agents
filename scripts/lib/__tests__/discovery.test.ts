import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccess = vi.fn<(..._args: unknown[]) => Promise<void>>();
// readdir is now called with { withFileTypes: true } for the projects dir and
// each project dir (returns Dirent-likes), and plain (returns string[]) for the
// per-session `subagents` dir — so the resolved type is a union of both.
const mockReaddir = vi.fn<(..._args: unknown[]) => Promise<unknown[]>>();
const mockStat = vi.fn<(..._args: unknown[]) => Promise<{ isDirectory: () => boolean; mtimeMs: number; size: number }>>();

/** Minimal fs.Dirent stand-in for readdir(..., { withFileTypes: true }). */
function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

vi.mock("node:fs/promises", () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

// node:fs is still used for readFileSync on meta files
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
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

import * as fs from "node:fs";
import { extractTaskFromJSONL, readNewLines } from "../file-reader";
import {
  discoverActiveSessions,
  refreshTrackedAgents,
  selectStaleAgentIds,
  selectLosingMains,
  isEphemeralProjectDir,
} from "../discovery";
import { agentFilePaths, updateAgentStatus } from "../agent-state";
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

  it("returns early when projects directory does not exist", async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(discoverActiveSessions("/nonexistent")).resolves.toBeUndefined();
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it("handles an empty projects directory", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);

    await expect(discoverActiveSessions("/projects")).resolves.toBeUndefined();
  });

  it("skips ephemeral project dirs (temp / var-folders) so background SDK runs don't pollute the topology", async () => {
    mockAccess.mockResolvedValue(undefined);
    // First readdir (withFileTypes): top-level project dirs as Dirents.
    mockReaddir.mockResolvedValueOnce([
      dirent("-private-tmp", true),
      dirent("-private-var-folders-nd-vn6fz1m57xvf7c4mn", true),
      dirent("-Users-erdos-Github-agents", true),
    ]);
    // readdir for the surviving project dir contents — return [] to short-circuit
    mockReaddir.mockResolvedValue([]);

    await discoverActiveSessions("/projects");

    // Ephemeral dirs are filtered by name from the Dirents and never descended
    // into; only the real workspace gets a follow-up readdir. (No per-entry
    // stat() happens at this level anymore.)
    const readDirs = mockReaddir.mock.calls.map((c) => String(c[0]));
    expect(readDirs.some((p) => p.includes("-private-tmp"))).toBe(false);
    expect(readDirs.some((p) => p.includes("-private-var-folders"))).toBe(false);
    expect(readDirs.some((p) => p.endsWith("-Users-erdos-Github-agents"))).toBe(true);
  });
});

describe("refreshTrackedAgents", () => {
  it("stats only already-tracked files and never walks the project tree", async () => {
    agentFilePaths.clear();
    agentFilePaths.set("agent-1", "/projects/p/agent-1.jsonl");
    agentFilePaths.set("agent-2", "/projects/p/agent-2.jsonl");
    vi.mocked(readNewLines).mockReturnValue([]);
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: Date.now(), size: 10 });

    await refreshTrackedAgents();

    const statted = mockStat.mock.calls.map((c) => String(c[0]));
    expect(statted).toContain("/projects/p/agent-1.jsonl");
    expect(statted).toContain("/projects/p/agent-2.jsonl");
    expect(statted).toHaveLength(2);
    // The fast tick must not read any directory — that's the whole point.
    expect(mockReaddir).not.toHaveBeenCalled();
    // Each tracked agent's status is refreshed from its file mtime.
    expect(vi.mocked(updateAgentStatus)).toHaveBeenCalledTimes(2);
  });

  it("skips files that have vanished without throwing", async () => {
    agentFilePaths.clear();
    agentFilePaths.set("gone", "/projects/p/gone.jsonl");
    vi.mocked(readNewLines).mockReturnValue([]);
    mockStat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await expect(refreshTrackedAgents()).resolves.toBeUndefined();
    expect(vi.mocked(updateAgentStatus)).not.toHaveBeenCalled();
  });
});

describe("isEphemeralProjectDir", () => {
  it.each([
    "-private-tmp",
    "-private-tmp-some-script",
    "-private-var-folders-nd-vn6fz1m57xvf7c4mn2gn8lmr0000gn-T",
    "-private-var-tmp",
    "-private-var-tmp-staging",
    "-tmp",
    "-tmp-foo",
    "-var-folders-nd-abc",
    "-var-tmp-something",
  ])("matches ephemeral path: %s", (dir) => {
    expect(isEphemeralProjectDir(dir)).toBe(true);
  });

  it.each([
    "-Users-erdos-Github-agents",
    "-Users-erdos-Github-ipportal2",
    "-Users-erdos-Documents-GitHub-myproj",
    "-Users-erdos-tmp-project",
    "-Users-foo-var-folders-bar",
    "-Users-erdos-Github-cacti-api",
  ])("does not match real workspace: %s", (dir) => {
    expect(isEphemeralProjectDir(dir)).toBe(false);
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

describe("selectStaleAgentIds — terminal children must not protect parent forever", () => {
  it("purges a stale main whose only child has status=completed and old mtime", () => {
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "completed", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + old],
    ]);
    // The bug: status "completed" !== "idle" so it was protecting the parent.
    // After the fix only running/waiting children protect the parent.
    // The completed sub is a terminal state — not added to stale[] by design,
    // but the parent (stuck idle) IS now eligible for purge.
    const result = selectStaleAgentIds(agents, mtimes, now);
    expect(result).toContain("main");
    expect(result).not.toContain("sub"); // completed is terminal, not stuck
  });

  it("purges a stale main whose only child has status=error and old mtime", () => {
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "error", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + old],
    ]);
    // Same reasoning: error is terminal, main (idle+stale) is now purgeable.
    const result = selectStaleAgentIds(agents, mtimes, now);
    expect(result).toContain("main");
    expect(result).not.toContain("sub"); // error is terminal, not stuck
  });

  it("protects a stale main when a child has status=running", () => {
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const fresh = -60_000;
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

  it("protects a stale main when a child has status=waiting", () => {
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const fresh = -60_000;
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["sub", { parentId: "main", status: "waiting", startTime: now + fresh }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["sub", now + fresh],
    ]);
    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
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
  // All existing tests use mtimes well in the past relative to NOW, so the
  // "loser must be silent" guard is satisfied. Tests that exercise the guard
  // explicitly use mtimes within RUNNING_THRESHOLD of NOW.
  const NOW = 10_000_000;

  it("returns an empty list when every project has exactly one main", () => {
    const agents = new Map<string, MainShape>([
      ["main-a", mkMain("/proj-a")],
      ["main-b", mkMain("/proj-b")],
    ]);
    const mtimes = new Map<string, number>([
      ["main-a", 100],
      ["main-b", 200],
    ]);
    expect(selectLosingMains(agents, mtimes, NOW)).toEqual([]);
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
    const result = selectLosingMains(agents, mtimes, NOW);
    expect(result).toEqual(["old"]);
    expect(result).not.toContain("new");
  });

  it("does NOT evict a fresh loser — keeps two concurrent sessions in the same project", () => {
    // Both mains have been written to in the last few seconds; the slightly
    // older one is still a real session, not a ghost.
    const agents = new Map<string, MainShape>([
      ["older", mkMain("/proj")],
      ["newer", mkMain("/proj")],
    ]);
    const mtimes = new Map<string, number>([
      ["older", NOW - 5_000], // 5s ago — well within RUNNING_THRESHOLD (45s)
      ["newer", NOW - 1_000], // 1s ago
    ]);
    expect(selectLosingMains(agents, mtimes, NOW)).toEqual([]);
  });

  it("evicts a stale loser even when the winner is fresh — kills /clear ghosts", () => {
    const agents = new Map<string, MainShape>([
      ["ghost", mkMain("/proj")],
      ["live", mkMain("/proj")],
    ]);
    const mtimes = new Map<string, number>([
      ["ghost", NOW - 120_000], // 2 min silent → genuine ghost
      ["live", NOW - 1_000],
    ]);
    expect(selectLosingMains(agents, mtimes, NOW)).toEqual(["ghost"]);
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
    const result = selectLosingMains(agents, mtimes, NOW).sort();
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
    expect(selectLosingMains(agents, mtimes, NOW)).toEqual([]);
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
    expect(selectLosingMains(agents1, mtimes1, NOW)).toEqual(["a"]);

    // Everything ties → lexically greater id wins (descending), so "a" loses.
    const agents2 = new Map<string, MainShape>([
      ["a", mkMain("/proj", 100)],
      ["z", mkMain("/proj", 100)],
    ]);
    const mtimes2 = new Map<string, number>([
      ["a", 1000],
      ["z", 1000],
    ]);
    expect(selectLosingMains(agents2, mtimes2, NOW)).toEqual(["a"]);
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
    const result = selectLosingMains(agents, mtimes, NOW).sort();
    expect(result).toEqual(["m1", "m1-sub", "m2", "m2-sub"]);
    expect(result).not.toContain("m3");
    expect(result).not.toContain("m3-sub");
  });
});

describe("settings.json cache — reads each path at most once per discovery pass", () => {
  it("reads each settings.json path once even when multiple agents are discovered in one pass", async () => {
    // Make readFileSync return empty-but-valid JSON so the cache stores a
    // non-null result and later agents retrieve it without a second read.
    const readFileSyncMock = vi.mocked(fs.readFileSync);
    readFileSyncMock.mockReturnValue("{}");

    // beforeEach's resetAllMocks() wipes the factory return values, so the two
    // file-reader helpers reached during registration must be re-stubbed here.
    vi.mocked(extractTaskFromJSONL).mockReturnValue({
      task: "test task",
      slug: "test-slug",
      model: "claude-sonnet-4-20250514",
      startTime: Date.now(),
    });
    vi.mocked(readNewLines).mockReturnValue([]);

    const projectDirName = "-Users-erdos-Github-agents";
    // Real UUID filenames so both main sessions actually register (the UUID
    // gate in discovery rejects non-UUID stems), exercising the cache for real.
    const sessionA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const now = Date.now();
    const recentMtime = now - 1000; // 1 s ago — well within DISCOVERY_THRESHOLD

    // fsp.access: always succeeds
    mockAccess.mockResolvedValue(undefined);

    // fsp.readdir calls (both withFileTypes → Dirents):
    //   1st call → top-level entries (one project dir)
    //   2nd call → project dir entries (two main JSONL files, no session subdirs)
    mockReaddir
      .mockResolvedValueOnce([dirent(projectDirName, true)])
      .mockResolvedValueOnce([
        dirent(`${sessionA}.jsonl`, false),
        dirent(`${sessionB}.jsonl`, false),
      ]);

    // fsp.stat is now only hit for the per-file mtime/age check on the two main
    // JSONL files — directory classification comes from the Dirents above.
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: recentMtime, size: 100 });

    await discoverActiveSessions("/projects");

    // Collect all paths passed to readFileSync that are settings.json files.
    const settingsPaths = readFileSyncMock.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.endsWith("settings.json"));

    // Each unique settings path must appear at most once.
    const uniquePaths = new Set(settingsPaths);
    expect(settingsPaths.length).toBe(uniquePaths.size);

    // Both agents are in the same project dir so we expect exactly:
    //   1 × project settings.json  +  1 × user settings.json = 2 reads total.
    // Without the cache it would be 4 (2 agents × 2 candidates each).
    expect(settingsPaths.length).toBe(2);
  });
});
