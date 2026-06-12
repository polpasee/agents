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

vi.mock("../agent-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-state")>();
  // Spread the real module so the state maps (globalThis-backed) and the
  // spawn-index helpers stay real; wrap only the functions tests assert on
  // or need neutered. The nested-subagent fixtures below restore the real
  // implementations per test via mockImplementation(actualAgentState.*).
  return {
    ...actual,
    registerAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    processEntry: vi.fn(),
    parseAgentType: vi.fn().mockReturnValue("generic"),
    broadcast: vi.fn(),
    upsertWorkflow: vi.fn(),
    removeWorkflow: vi.fn(),
    reparentAgent: vi.fn(),
  };
});

// Step 1.5 of discoverActiveSessions scans each session's workflows dir; stub
// it out so the readdir/stat mocks above only have to model agent discovery.
vi.mock("../workflow-scan", () => ({
  scanWorkflows: vi.fn().mockResolvedValue([]),
}));

import * as fs from "node:fs";
import * as path from "node:path";
import { extractTaskFromJSONL, readNewLines } from "../file-reader";
import { scanWorkflows } from "../workflow-scan";
import {
  discoverActiveSessions,
  refreshTrackedAgents,
  selectStaleAgentIds,
  selectLosingMains,
  isEphemeralProjectDir,
  pendingReparents,
} from "../discovery";
import {
  agents,
  edges,
  teams,
  agentLastModified,
  removedAgentIds,
  agentFilePaths,
  registerAgent,
  updateAgentStatus,
  processEntry,
  parseAgentType,
  reparentAgent,
  spawnIndex,
  viewers,
  broadcast,
} from "../agent-state";
import { DISCOVERY_THRESHOLD_MS, STALE_THRESHOLD_MS, STATUS_RUNNING_THRESHOLD_MS, SUBAGENT_STALE_THRESHOLD_MS } from "../config";

// The unmocked module — used by the nested-subagent fixtures to restore real
// implementations onto the vi.fn wrappers after each resetAllMocks(). State
// maps are globalThis-backed, so both instances share the same storage.
const actualAgentState = await vi.importActual<typeof import("../agent-state")>("../agent-state");

beforeEach(() => {
  vi.resetAllMocks();
  agents.clear();
  edges.length = 0;
  teams.clear();
  agentLastModified.clear();
  removedAgentIds.clear();
  agentFilePaths.clear();
  spawnIndex.clear();
  pendingReparents.clear();
  viewers.clear();
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

describe("selectStaleAgentIds — transitive shield through quiet middle spawners", () => {
  it("shields the whole ancestor chain while a deep descendant is still active", () => {
    // main ← mid ← leaf: the mid spawner is blocked on the Agent tool and has
    // been silent beyond BOTH thresholds, so nothing shields main except the
    // transitive walk from the still-active leaf.
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const fresh = -1_000;
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["mid", { parentId: "main", status: "idle", startTime: now + old }],
      ["leaf", { parentId: "mid", status: "running", startTime: now + fresh }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["mid", now + old], // beyond the 60s sub-agent threshold AND the main threshold
      ["leaf", now + fresh],
    ]);

    const result = selectStaleAgentIds(agents, mtimes, now);
    expect(result).not.toContain("main");
    expect(result).not.toContain("mid");
    expect(result).toEqual([]);
  });

  it("releases the chain once the deep descendant goes quiet too (control)", () => {
    const now = Date.now();
    const old = -STALE_THRESHOLD_MS - 60_000;
    const agents = new Map<string, { parentId?: string; status: string; startTime: number }>([
      ["main", { status: "idle", startTime: now + old }],
      ["mid", { parentId: "main", status: "idle", startTime: now + old }],
      ["leaf", { parentId: "mid", status: "idle", startTime: now + old }],
    ]);
    const mtimes = new Map([
      ["main", now + old],
      ["mid", now + old],
      ["leaf", now + old],
    ]);

    const result = selectStaleAgentIds(agents, mtimes, now);
    expect(result).toContain("mid");
    expect(result).toContain("leaf");
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
    vi.mocked(scanWorkflows).mockResolvedValue([]);

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

describe("discoverActiveSessions — nested sub-agent parent resolution", () => {
  const FIX_PROJECT = "-Users-erdos-Github-agents";
  const FIX_PROJECT_PATH = path.join("/projects", FIX_PROJECT);

  let sessionId: string;
  let subagentListing: string[];
  /** jsonl path → unread lines; consumed on read like real offset tracking */
  let pendingLines: Map<string, string[]>;
  let metaContents: Map<string, string>;

  const sessionJsonlPath = () => path.join(FIX_PROJECT_PATH, `${sessionId}.jsonl`);
  const subagentsDir = () => path.join(FIX_PROJECT_PATH, sessionId, "subagents");
  const agentJsonlPath = (id: string) => path.join(subagentsDir(), `agent-${id}.jsonl`);

  /** A JSONL line whose assistant message contains an Agent spawn tool_use. */
  function spawnLine(toolUseId: string): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "Agent", input: { description: "spawn" } }],
      },
    });
  }

  function buildFixture(opts: {
    sessionId: string;
    sessionLines: string[];
    subagents: Array<{ id: string; lines?: string[]; meta?: Record<string, unknown> }>;
  }): void {
    sessionId = opts.sessionId;
    pendingLines = new Map([[sessionJsonlPath(), opts.sessionLines]]);
    metaContents = new Map();
    subagentListing = [];
    for (const sub of opts.subagents) {
      subagentListing.push(`agent-${sub.id}.jsonl`);
      pendingLines.set(agentJsonlPath(sub.id), sub.lines ?? []);
      if (sub.meta) {
        subagentListing.push(`agent-${sub.id}.meta.json`);
        metaContents.set(path.join(subagentsDir(), `agent-${sub.id}.meta.json`), JSON.stringify(sub.meta));
      }
    }

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockImplementation(async (p: unknown) => {
      const dir = String(p);
      if (dir === "/projects") return [dirent(FIX_PROJECT, true)];
      if (dir === FIX_PROJECT_PATH) return [dirent(`${sessionId}.jsonl`, false), dirent(sessionId, true)];
      if (dir === subagentsDir()) return [...subagentListing];
      return [];
    });
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: Date.now() - 1_000, size: 100 });
    vi.mocked(readNewLines).mockImplementation((p: string) => {
      const lines = pendingLines.get(p) ?? [];
      pendingLines.set(p, []);
      return lines;
    });
    vi.mocked(fs.readFileSync).mockImplementation(((p: unknown) => {
      const content = metaContents.get(String(p));
      if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return content;
    }) as typeof fs.readFileSync);
  }

  beforeEach(() => {
    // The file-level resetAllMocks() wiped implementations; restore the real
    // agent-state behaviour so scans mutate the actual state maps.
    vi.mocked(registerAgent).mockImplementation(actualAgentState.registerAgent);
    vi.mocked(updateAgentStatus).mockImplementation(actualAgentState.updateAgentStatus);
    vi.mocked(processEntry).mockImplementation(actualAgentState.processEntry);
    vi.mocked(parseAgentType).mockImplementation(actualAgentState.parseAgentType);
    vi.mocked(reparentAgent).mockImplementation(actualAgentState.reparentAgent);
    vi.mocked(scanWorkflows).mockResolvedValue([]);
    vi.mocked(extractTaskFromJSONL).mockReturnValue({
      task: "test task",
      slug: "test-slug",
      model: "claude-sonnet-4-20250514",
      startTime: Date.now(),
    });
  });

  it("parents a nested sub-agent to its spawner even when the child file sorts first", async () => {
    const sess = "11111111-1111-1111-1111-111111111111";
    buildFixture({
      sessionId: sess,
      sessionLines: [spawnLine("toolu_A")],
      subagents: [
        // Child sorts alphabetically before its spawner ("aaa" < "bbb"),
        // matching the real readdir order hazard.
        { id: "aaa-child", meta: { agentType: "build", description: "child", toolUseId: "toolu_B" } },
        { id: "bbb-parent", lines: [spawnLine("toolu_B")], meta: { agentType: "explore", description: "parent", toolUseId: "toolu_A" } },
      ],
    });

    await discoverActiveSessions("/projects");

    expect(agents.get("bbb-parent")?.parentId).toBe(sess);
    expect(agents.get("aaa-child")?.parentId).toBe("bbb-parent");
    expect(edges).toContainEqual({ source: "bbb-parent", target: "aaa-child" });
    expect(pendingReparents.size).toBe(0);
  });

  it("resolves every level of a depth-5 spawn chain", async () => {
    const sess = "22222222-2222-2222-2222-222222222222";
    buildFixture({
      sessionId: sess,
      sessionLines: [spawnLine("toolu_1")],
      subagents: [
        // Listed deepest-first to force the dependency sort to reorder.
        { id: "lvl5", meta: { description: "l5", toolUseId: "toolu_5" } },
        { id: "lvl4", lines: [spawnLine("toolu_5")], meta: { description: "l4", toolUseId: "toolu_4" } },
        { id: "lvl3", lines: [spawnLine("toolu_4")], meta: { description: "l3", toolUseId: "toolu_3" } },
        { id: "lvl2", lines: [spawnLine("toolu_3")], meta: { description: "l2", toolUseId: "toolu_2" } },
        { id: "lvl1", lines: [spawnLine("toolu_2")], meta: { description: "l1", toolUseId: "toolu_1" } },
      ],
    });

    await discoverActiveSessions("/projects");

    expect(agents.get("lvl1")?.parentId).toBe(sess);
    expect(agents.get("lvl2")?.parentId).toBe("lvl1");
    expect(agents.get("lvl3")?.parentId).toBe("lvl2");
    expect(agents.get("lvl4")?.parentId).toBe("lvl3");
    expect(agents.get("lvl5")?.parentId).toBe("lvl4");
  });

  it("falls back to the session when meta.json has no toolUseId", async () => {
    const sess = "33333333-3333-3333-3333-333333333333";
    buildFixture({
      sessionId: sess,
      sessionLines: [],
      subagents: [{ id: "plain", meta: { agentType: "explore", description: "no spawn pointer" } }],
    });

    await discoverActiveSessions("/projects");

    expect(agents.get("plain")?.parentId).toBe(sess);
    expect(pendingReparents.size).toBe(0);
  });

  it("re-parents on a later scan once the spawner's tool_use line appears (cross-tick race)", async () => {
    const sess = "44444444-4444-4444-4444-444444444444";
    buildFixture({
      sessionId: sess,
      sessionLines: [spawnLine("toolu_A")],
      subagents: [
        // The parent's spawning line has not been flushed yet on the first scan.
        { id: "late-child", meta: { description: "child", toolUseId: "toolu_B" } },
        { id: "parent", meta: { description: "parent", toolUseId: "toolu_A" } },
      ],
    });

    await discoverActiveSessions("/projects");

    expect(agents.get("late-child")?.parentId).toBe(sess);
    expect(pendingReparents.get("late-child")).toBe("toolu_B");

    // The spawning tool_use line lands in the parent's JSONL before scan 2.
    pendingLines.set(agentJsonlPath("parent"), [spawnLine("toolu_B")]);
    const sent: Array<{ type: string; event?: Record<string, unknown> }> = [];
    viewers.add({ send: (data: string) => sent.push(JSON.parse(data)) });

    await discoverActiveSessions("/projects");

    expect(agents.get("late-child")?.parentId).toBe("parent");
    expect(edges).toContainEqual({ source: "parent", target: "late-child" });
    expect(edges.some((e) => e.source === sess && e.target === "late-child")).toBe(false);
    expect(pendingReparents.has("late-child")).toBe(false);
    // The re-parent was broadcast as a refreshed registration.
    const rebroadcast = sent.find(
      (m) => m.type === "state:update" && m.event?.type === "agent:register" && m.event?.agentId === "late-child",
    );
    expect(rebroadcast?.event?.parentId).toBe("parent");
  });

  it("never reads compact- transcripts: no readNewLines call, no spawn-index pollution", async () => {
    const sess = "55555555-5555-5555-5555-555555555555";
    buildFixture({
      sessionId: sess,
      sessionLines: [],
      subagents: [
        // A fresh compact transcript containing a replayed Agent spawn line.
        { id: "compact-x", lines: [spawnLine("toolu_C")] },
        { id: "normal", meta: { agentType: "explore", description: "real sub" } },
      ],
    });

    await discoverActiveSessions("/projects");

    // The gated file is never opened, so its replayed spawn id never lands.
    const readPaths = vi.mocked(readNewLines).mock.calls.map((c) => String(c[0]));
    expect(readPaths).not.toContain(agentJsonlPath("compact-x"));
    expect(spawnIndex.has("toolu_C")).toBe(false);
    expect(agents.has("compact-x")).toBe(false);
    // Session freshness/backfill and sibling discovery are unaffected.
    expect(agents.has(sess)).toBe(true);
    expect(agents.get("normal")?.parentId).toBe(sess);
  });

  it("tombstone gates reads until a newer write, then replays the backlog", async () => {
    const sess = "66666666-6666-6666-6666-666666666666";
    buildFixture({
      sessionId: sess,
      sessionLines: [],
      subagents: [{ id: "X", lines: [spawnLine("toolu_X")], meta: { description: "tombstoned" } }],
    });
    const NOW = Date.now();
    removedAgentIds.set("X", NOW);

    // Scan 1: the file's mtime predates the tombstone — must stay unread.
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: NOW - 1_000, size: 100 });
    await discoverActiveSessions("/projects");

    const firstScanReads = vi.mocked(readNewLines).mock.calls.map((c) => String(c[0]));
    expect(firstScanReads).not.toContain(agentJsonlPath("X"));
    expect(agents.has("X")).toBe(false);
    expect(spawnIndex.has("toolu_X")).toBe(false);

    // A write lands after removal: mtime now exceeds the tombstone.
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: NOW + 5_000, size: 200 });
    await discoverActiveSessions("/projects");

    expect(vi.mocked(readNewLines).mock.calls.map((c) => String(c[0]))).toContain(agentJsonlPath("X"));
    expect(agents.has("X")).toBe(true);
    expect(removedAgentIds.has("X")).toBe(false);
    // The unread backlog replayed: its spawn line reached the index and the
    // buffered entry was processed into the re-registered agent's tool calls.
    expect(spawnIndex.get("toolu_X")).toBe("X");
    expect(agents.get("X")?.toolCalls.length).toBeGreaterThan(0);
  });

  it("heals a child that registered before its meta file appeared (late-meta race)", async () => {
    const sess = "77777777-7777-7777-7777-777777777777";
    buildFixture({
      sessionId: sess,
      sessionLines: [spawnLine("toolu_A")],
      subagents: [
        { id: "spawner", lines: [spawnLine("toolu_B")], meta: { description: "spawner", toolUseId: "toolu_A" } },
        { id: "c1" }, // JSONL listed, meta.json not flushed yet
      ],
    });

    await discoverActiveSessions("/projects");

    // Scan 1: no toolUseId visible — anchored to the session, no retry queued.
    expect(agents.get("c1")?.parentId).toBe(sess);
    expect(pendingReparents.size).toBe(0);

    // The meta file lands before scan 2, pointing at the live spawner.
    subagentListing.push("agent-c1.meta.json");
    metaContents.set(
      path.join(subagentsDir(), "agent-c1.meta.json"),
      JSON.stringify({ description: "child", toolUseId: "toolu_B" }),
    );

    await discoverActiveSessions("/projects");

    // Healed via pendingReparents + the post-scan retry.
    expect(agents.get("c1")?.parentId).toBe("spawner");
    expect(pendingReparents.has("c1")).toBe(false);
    expect(edges).toContainEqual({ source: "spawner", target: "c1" });
    expect(edges.some((e) => !e.edgeType && e.source === sess && e.target === "c1")).toBe(false);
  });

  it("does not queue a retry when meta.toolUseId points at the child itself", async () => {
    const sess = "88888888-8888-8888-8888-888888888888";
    buildFixture({
      sessionId: sess,
      sessionLines: [],
      subagents: [
        // The child's OWN transcript carries the tool_use id its meta names,
        // so the spawn index resolves the id to the child itself.
        { id: "selfie", lines: [spawnLine("toolu_S")], meta: { description: "self", toolUseId: "toolu_S" } },
      ],
    });

    await discoverActiveSessions("/projects");

    expect(spawnIndex.get("toolu_S")).toBe("selfie");
    expect(agents.get("selfie")?.parentId).toBe(sess);
    // A self-pointing id can never resolve to a usable parent — no retry.
    expect(pendingReparents.has("selfie")).toBe(false);
    expect(pendingReparents.size).toBe(0);
  });
});

describe("discoverActiveSessions — workflow sub-agent discovery", () => {
  const FIX_PROJECT = "-Users-erdos-Github-agents";
  const FIX_PROJECT_PATH = path.join("/projects", FIX_PROJECT);

  let sessionId: string;
  let pendingLines: Map<string, string[]>;
  let metaContents: Map<string, string>;

  const sessionJsonlPath = () => path.join(FIX_PROJECT_PATH, `${sessionId}.jsonl`);
  const subagentsDir = () => path.join(FIX_PROJECT_PATH, sessionId, "subagents");
  const workflowsDir = () => path.join(subagentsDir(), "workflows");
  const runDirPath = (runId: string) => path.join(workflowsDir(), runId);

  /**
   * Like the nested-suite fixture, but models the Workflow tool's on-disk
   * layout: flat sub-agents in subagents/ plus run dirs one level deeper at
   * subagents/workflows/<runId>/ holding agent-*.jsonl transcripts.
   */
  function buildFixture(opts: {
    sessionId: string;
    flat?: Array<{ id: string; meta?: Record<string, unknown> }>;
    runs?: Record<string, Array<{ name: string; meta?: Record<string, unknown> }>>;
    /** Non-directory entries listed directly inside subagents/workflows/. */
    looseWorkflowFiles?: string[];
  }): void {
    sessionId = opts.sessionId;
    pendingLines = new Map([[sessionJsonlPath(), []]]);
    metaContents = new Map();

    const subListing: string[] = [];
    for (const sub of opts.flat ?? []) {
      subListing.push(`agent-${sub.id}.jsonl`);
      pendingLines.set(path.join(subagentsDir(), `agent-${sub.id}.jsonl`), []);
      if (sub.meta) {
        subListing.push(`agent-${sub.id}.meta.json`);
        metaContents.set(path.join(subagentsDir(), `agent-${sub.id}.meta.json`), JSON.stringify(sub.meta));
      }
    }

    const wfEntries: unknown[] = [];
    const runListings = new Map<string, string[]>();
    if (opts.runs || opts.looseWorkflowFiles) {
      subListing.push("workflows");
      for (const [runId, runFiles] of Object.entries(opts.runs ?? {})) {
        wfEntries.push(dirent(runId, true));
        const names: string[] = [];
        for (const f of runFiles) {
          names.push(f.name);
          pendingLines.set(path.join(runDirPath(runId), f.name), []);
          if (f.meta) {
            const metaName = f.name.replace(/\.jsonl$/, ".meta.json");
            names.push(metaName);
            metaContents.set(path.join(runDirPath(runId), metaName), JSON.stringify(f.meta));
          }
        }
        runListings.set(runDirPath(runId), names);
      }
      for (const loose of opts.looseWorkflowFiles ?? []) {
        wfEntries.push(dirent(loose, false));
      }
    }

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockImplementation(async (p: unknown) => {
      const dir = String(p);
      if (dir === "/projects") return [dirent(FIX_PROJECT, true)];
      if (dir === FIX_PROJECT_PATH) return [dirent(`${sessionId}.jsonl`, false), dirent(sessionId, true)];
      if (dir === subagentsDir()) return [...subListing];
      if (dir === workflowsDir()) return wfEntries;
      const run = runListings.get(dir);
      if (run) return [...run];
      return [];
    });
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: Date.now() - 1_000, size: 100 });
    vi.mocked(readNewLines).mockImplementation((p: string) => {
      const lines = pendingLines.get(p) ?? [];
      pendingLines.set(p, []);
      return lines;
    });
    vi.mocked(fs.readFileSync).mockImplementation(((p: unknown) => {
      const content = metaContents.get(String(p));
      if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return content;
    }) as typeof fs.readFileSync);
  }

  beforeEach(() => {
    // The file-level resetAllMocks() wiped implementations; restore the real
    // agent-state behaviour so scans mutate the actual state maps.
    vi.mocked(registerAgent).mockImplementation(actualAgentState.registerAgent);
    vi.mocked(updateAgentStatus).mockImplementation(actualAgentState.updateAgentStatus);
    vi.mocked(processEntry).mockImplementation(actualAgentState.processEntry);
    vi.mocked(parseAgentType).mockImplementation(actualAgentState.parseAgentType);
    vi.mocked(reparentAgent).mockImplementation(actualAgentState.reparentAgent);
    vi.mocked(scanWorkflows).mockResolvedValue([]);
    vi.mocked(extractTaskFromJSONL).mockReturnValue({
      task: "test task",
      slug: "test-slug",
      model: "claude-sonnet-4-20250514",
      startTime: Date.now(),
    });
  });

  it("registers a nested workflow sub-agent anchored to the session", async () => {
    const sess = "aaaa1111-1111-1111-1111-111111111111";
    buildFixture({
      sessionId: sess,
      runs: { wf_x: [{ name: "agent-a1.jsonl", meta: { agentType: "workflow-subagent" } }] },
    });

    await discoverActiveSessions("/projects");

    const agent = agents.get("a1");
    expect(agent?.parentId).toBe(sess);
    expect(agent?.agentType).toBe("generic");
    expect(agent?.displayType).toBe("workflow-subagent");
    expect(agentFilePaths.get("a1")).toBe(path.join(runDirPath("wf_x"), "agent-a1.jsonl"));
    expect(pendingReparents.size).toBe(0);
  });

  it("discovers flat and nested sub-agents in the same session", async () => {
    const sess = "aaaa2222-2222-2222-2222-222222222222";
    buildFixture({
      sessionId: sess,
      flat: [{ id: "flat1", meta: { agentType: "explore", description: "flat sub" } }],
      runs: { wf_x: [{ name: "agent-n1.jsonl", meta: { agentType: "workflow-subagent" } }] },
    });

    await discoverActiveSessions("/projects");

    expect(agents.get("flat1")?.parentId).toBe(sess);
    expect(agents.get("flat1")?.agentType).toBe("explore");
    expect(agents.get("n1")?.parentId).toBe(sess);
    expect(agents.get("n1")?.displayType).toBe("workflow-subagent");
  });

  it("does not register journal.jsonl in a run dir as an agent", async () => {
    const sess = "aaaa3333-3333-3333-3333-333333333333";
    buildFixture({
      sessionId: sess,
      runs: {
        wf_x: [
          { name: "journal.jsonl" },
          { name: "agent-a1.jsonl", meta: { agentType: "workflow-subagent" } },
        ],
      },
    });

    await discoverActiveSessions("/projects");

    expect(agents.has("a1")).toBe(true);
    // Only the session main and the one workflow agent registered.
    expect([...agents.keys()].sort()).toEqual([sess, "a1"].sort());
  });

  it("keeps ignoring compact- transcripts inside run dirs", async () => {
    const sess = "aaaa4444-4444-4444-4444-444444444444";
    buildFixture({
      sessionId: sess,
      runs: {
        wf_x: [
          { name: "agent-compact-123.jsonl" },
          { name: "agent-real.jsonl", meta: { agentType: "workflow-subagent" } },
        ],
      },
    });

    await discoverActiveSessions("/projects");

    expect(agents.has("compact-123")).toBe(false);
    // The gated transcript is never opened, same as flat compact- files —
    // while the legit sibling in the same run dir IS read.
    const readPaths = vi.mocked(readNewLines).mock.calls.map((c) => String(c[0]));
    expect(readPaths).not.toContain(path.join(runDirPath("wf_x"), "agent-compact-123.jsonl"));
    expect(readPaths).toContain(path.join(runDirPath("wf_x"), "agent-real.jsonl"));
    expect(agents.get("real")?.parentId).toBe(sess);
  });

  it("does not pick up files directly inside subagents/workflows/", async () => {
    const sess = "aaaa5555-5555-5555-5555-555555555555";
    buildFixture({
      sessionId: sess,
      runs: { wf_x: [{ name: "agent-in-run.jsonl", meta: { agentType: "workflow-subagent" } }] },
      looseWorkflowFiles: ["agent-loose.jsonl"],
    });

    await discoverActiveSessions("/projects");

    // The descent only enters run *directories*; loose files define its boundary.
    expect(agents.has("loose")).toBe(false);
    expect(agents.has("in-run")).toBe(true);
  });

  it("applies the discovery age gate to transcripts inside run dirs", async () => {
    const sess = "aaaa6666-6666-6666-6666-666666666666";
    buildFixture({
      sessionId: sess,
      runs: {
        wf_x: [
          { name: "agent-stale.jsonl", meta: { agentType: "workflow-subagent" } },
          { name: "agent-fresh.jsonl", meta: { agentType: "workflow-subagent" } },
        ],
      },
    });
    const stalePath = path.join(runDirPath("wf_x"), "agent-stale.jsonl");
    mockStat.mockImplementation(async (p: unknown) => ({
      isDirectory: () => false,
      mtimeMs: String(p) === stalePath
        ? Date.now() - DISCOVERY_THRESHOLD_MS - 60_000
        : Date.now() - 1_000,
      size: 100,
    }));

    await discoverActiveSessions("/projects");

    // The stale transcript never registers and is never opened — nested
    // candidates flow through Phase A's age gate exactly like flat ones.
    expect(agents.has("stale")).toBe(false);
    const readPaths = vi.mocked(readNewLines).mock.calls.map((c) => String(c[0]));
    expect(readPaths).not.toContain(stalePath);
    expect(agents.get("fresh")?.parentId).toBe(sess);
  });

  it("isolates a failing run dir: flat agents and sibling runs still register", async () => {
    const sess = "aaaa7777-7777-7777-7777-777777777777";
    buildFixture({
      sessionId: sess,
      flat: [{ id: "flat1", meta: { agentType: "explore", description: "flat sub" } }],
      runs: {
        wf_bad: [{ name: "agent-bad.jsonl", meta: { agentType: "workflow-subagent" } }],
        wf_good: [{ name: "agent-good.jsonl", meta: { agentType: "workflow-subagent" } }],
      },
    });
    const base = mockReaddir.getMockImplementation()!;
    mockReaddir.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]) === runDirPath("wf_bad")) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return base(...args);
    });

    await discoverActiveSessions("/projects");

    expect(agents.has("bad")).toBe(false);
    expect(agents.get("flat1")?.parentId).toBe(sess);
    expect(agents.get("good")?.parentId).toBe(sess);
  });

  it("warns and continues when workflows/ is unreadable (non-ENOENT)", async () => {
    const sess = "aaaa8888-8888-8888-8888-888888888888";
    buildFixture({
      sessionId: sess,
      flat: [{ id: "flat1", meta: { agentType: "explore", description: "flat sub" } }],
      runs: { wf_x: [{ name: "agent-n1.jsonl", meta: { agentType: "workflow-subagent" } }] },
    });
    const base = mockReaddir.getMockImplementation()!;
    mockReaddir.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]) === workflowsDir()) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return base(...args);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await discoverActiveSessions("/projects");

    // A persistent failure here silently reproduces the original bug —
    // it must leave a breadcrumb, while flat discovery carries on.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(workflowsDir()), expect.anything());
    expect(agents.has("n1")).toBe(false);
    expect(agents.get("flat1")?.parentId).toBe(sess);
    warnSpy.mockRestore();
  });

  it("skips silently when workflows/ vanished (ENOENT race)", async () => {
    const sess = "aaaa9999-9999-9999-9999-999999999999";
    buildFixture({
      sessionId: sess,
      flat: [{ id: "flat1", meta: { agentType: "explore", description: "flat sub" } }],
      runs: { wf_x: [{ name: "agent-n1.jsonl", meta: { agentType: "workflow-subagent" } }] },
    });
    const base = mockReaddir.getMockImplementation()!;
    mockReaddir.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]) === workflowsDir()) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return base(...args);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await discoverActiveSessions("/projects");

    const warnedWorkflows = warnSpy.mock.calls.some((c) => String(c[0]).includes(workflowsDir()));
    expect(warnedWorkflows).toBe(false);
    expect(agents.get("flat1")?.parentId).toBe(sess);
    warnSpy.mockRestore();
  });

  it("keeps the parent session alive via a fresh journal.jsonl alone", async () => {
    const sess = "aaaa0000-0000-0000-0000-000000000000";
    buildFixture({
      sessionId: sess,
      runs: { wf_x: [{ name: "journal.jsonl" }] },
    });
    // The main's JSONL went quiet (long-running workflow); the run journal is
    // the only fresh file. The session must still backfill and stay fresh.
    const FRESH = Date.now() - 1_000;
    const STALE = Date.now() - DISCOVERY_THRESHOLD_MS - 60_000;
    const journalPath = path.join(runDirPath("wf_x"), "journal.jsonl");
    mockStat.mockImplementation(async (p: unknown) => ({
      isDirectory: () => false,
      mtimeMs: String(p) === journalPath ? FRESH : STALE,
      size: 100,
    }));

    await discoverActiveSessions("/projects");

    expect(agents.has(sess)).toBe(true);
    expect(agentLastModified.get(sess)).toBe(FRESH);
    // The journal itself never becomes an agent.
    expect([...agents.keys()]).toEqual([sess]);
  });
});

describe("pruneState — dedup purge cleans spawn bookkeeping", () => {
  it("drops the losing main's spawnIndex entries and its descendant's pendingReparents entry", async () => {
    const NOW = Date.now();
    const register = actualAgentState.registerAgent;
    const base = { projectDir: "-Users-x-proj", task: "t", slug: "s", model: "m", startTime: NOW };
    register({ ...base, agentId: "winner", sessionId: "winner", agentType: "main" });
    register({ ...base, agentId: "loser", sessionId: "loser", agentType: "main" });
    register({ ...base, agentId: "loser-child", sessionId: "loser", agentType: "generic", parentId: "loser" });
    agentLastModified.set("winner", NOW);
    // Quiet past the running threshold (dedup-evictable) but well inside the
    // 10-minute stale window — and its fresh child shields it from the stale
    // path anyway — so only the dedup loop can evict it.
    agentLastModified.set("loser", NOW - STATUS_RUNNING_THRESHOLD_MS - 60_000);
    agentLastModified.set("loser-child", NOW);

    // Spawn bookkeeping owned by the evicted subtree.
    spawnIndex.set("toolu_loser", "loser");
    pendingReparents.set("loser-child", "toolu_unresolved");

    // No tracked files — refreshTrackedAgents just runs the maintenance pass.
    await refreshTrackedAgents();

    expect(agents.has("loser")).toBe(false);
    expect(agents.has("loser-child")).toBe(false);
    expect(agents.has("winner")).toBe(true);
    expect(spawnIndex.has("toolu_loser")).toBe(false);
    expect(pendingReparents.has("loser-child")).toBe(false);
  });
});

describe("pruneState — stale purge cleans every tracking structure", () => {
  it("purges a quiet sub-agent through the stale path: maps, spawn bookkeeping, edges, team, tombstone, broadcast", async () => {
    const NOW = Date.now();
    const register = actualAgentState.registerAgent;
    const base = { projectDir: "-Users-x-proj", task: "t", slug: "s", model: "m", startTime: NOW };
    register({ ...base, agentId: "main", sessionId: "main", agentType: "main" });
    register({
      ...base,
      agentId: "stale-sub",
      sessionId: "main",
      agentType: "generic",
      parentId: "main",
      teamId: "team-x",
      teamName: "Team X",
    });
    agentLastModified.set("main", NOW);
    // Quiet beyond the 60s sub-agent stale window, with no descendants to
    // shield it — only the stale loop can evict it (its parent is a single
    // fresh main, so the dedup loop never fires).
    agentLastModified.set("stale-sub", NOW - SUBAGENT_STALE_THRESHOLD_MS - 60_000);

    // Tracking state the purge must clean.
    agentFilePaths.set("main", "/projects/p/main.jsonl");
    agentFilePaths.set("stale-sub", "/projects/p/agent-stale-sub.jsonl");
    spawnIndex.set("toolu_owned", "stale-sub");
    pendingReparents.set("stale-sub", "toolu_unresolved");
    // Second incident edge on top of the parent edge from registration, so
    // both the source-match and target-match splice branches are covered.
    edges.push({ source: "stale-sub", target: "main", edgeType: "message" });

    // Files vanished (session dir cleaned up) → the refresh loop skips both
    // agents without touching mtimes and leaves eviction to pruneState.
    mockStat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await refreshTrackedAgents();

    // Tracking maps.
    expect(agents.has("stale-sub")).toBe(false);
    expect(agentLastModified.has("stale-sub")).toBe(false);
    expect(agentFilePaths.has("stale-sub")).toBe(false);
    // Spawn bookkeeping.
    expect(spawnIndex.has("toolu_owned")).toBe(false);
    expect(pendingReparents.has("stale-sub")).toBe(false);
    // Incident edges spliced (parent edge + message edge).
    expect(edges.some((e) => e.source === "stale-sub" || e.target === "stale-sub")).toBe(false);
    // Sole team member removed → empty team deleted.
    expect(teams.has("team-x")).toBe(false);
    // Tombstone set so the next scan doesn't immediately resurrect it.
    expect(removedAgentIds.has("stale-sub")).toBe(true);
    // Removal broadcast to viewers.
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith({ type: "state:remove", agentId: "stale-sub" });
    // The fresh main survives untouched.
    expect(agents.has("main")).toBe(true);
    expect(agentFilePaths.has("main")).toBe(true);
    expect(vi.mocked(broadcast)).not.toHaveBeenCalledWith({ type: "state:remove", agentId: "main" });
  });
});
