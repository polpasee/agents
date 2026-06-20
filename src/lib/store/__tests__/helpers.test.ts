import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  teamMembers,
  recomputeTeamForAgent,
  loadLocalStorage,
  saveLocalStorage,
} from "../helpers";
import type { AgentState, TeamState } from "../../types";
import { mockAgent } from "../../__tests__/test-utils";

// ── teamMembers ─────────────────────────────────────────────────────────────

describe("teamMembers", () => {
  it("returns empty array when memberIds is empty", () => {
    const agents = new Map<string, AgentState>();
    expect(teamMembers([], agents)).toEqual([]);
  });

  it("filters out unknown agent ids", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1" })],
    ]);
    const result = teamMembers(["a1", "unknown"], agents);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a1");
  });

  it("returns all resolved agents when all ids are valid", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1" })],
      ["a2", mockAgent({ id: "a2" })],
    ]);
    expect(teamMembers(["a1", "a2"], agents)).toHaveLength(2);
  });
});

// ── recomputeTeamForAgent ───────────────────────────────────────────────────

describe("recomputeTeamForAgent", () => {
  const makeTeam = (overrides: Partial<TeamState> = {}): TeamState => ({
    id: "t1",
    name: "Team 1",
    memberIds: ["a1", "a2"],
    status: "active",
    task: "test task",
    startTime: Date.now(),
    ...overrides,
  });

  it("returns null when agent is not in the store", () => {
    const result = recomputeTeamForAgent("missing", new Map(), new Map());
    expect(result).toBeNull();
  });

  it("returns null when agent has no teamId", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1", teamId: undefined })],
    ]);
    expect(recomputeTeamForAgent("a1", agents, new Map())).toBeNull();
  });

  it("returns null when team is not found in teams map", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1", teamId: "t1" })],
    ]);
    expect(recomputeTeamForAgent("a1", agents, new Map())).toBeNull();
  });

  it("returns updated teams map with recomputed status: error wins", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1", teamId: "t1", status: "error" })],
      ["a2", mockAgent({ id: "a2", teamId: "t1", status: "running" })],
    ]);
    const teams = new Map<string, TeamState>([["t1", makeTeam()]]);
    const result = recomputeTeamForAgent("a1", agents, teams);
    expect(result).not.toBeNull();
    expect(result!.get("t1")!.status).toBe("error");
  });

  it("computes completed status when all members completed", () => {
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1", teamId: "t1", status: "completed" })],
      ["a2", mockAgent({ id: "a2", teamId: "t1", status: "completed" })],
    ]);
    const teams = new Map<string, TeamState>([["t1", makeTeam()]]);
    const result = recomputeTeamForAgent("a1", agents, teams);
    expect(result!.get("t1")!.status).toBe("completed");
  });

  it("falls back to team.status when no members match any active status", () => {
    // Members have status "waiting" which is not error/completed/running/idle
    const agents = new Map<string, AgentState>([
      ["a1", mockAgent({ id: "a1", teamId: "t1", status: "waiting" })],
      ["a2", mockAgent({ id: "a2", teamId: "t1", status: "waiting" })],
    ]);
    const teams = new Map<string, TeamState>([
      ["t1", makeTeam({ status: "forming" })],
    ]);
    const result = recomputeTeamForAgent("a1", agents, teams);
    // Falls back to the team's existing status ("forming") because no members
    // have error/completed/running/idle status
    expect(result!.get("t1")!.status).toBe("forming");
  });
});

// ── loadLocalStorage ────────────────────────────────────────────────────────

describe("loadLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns fallback when key is not present", () => {
    expect(loadLocalStorage("missing-key", "default")).toBe("default");
  });

  it("returns parsed JSON value when key exists", () => {
    localStorage.setItem("test-num", "42");
    expect(loadLocalStorage("test-num", 0)).toBe(42);
  });

  it("returns raw string value when value is not valid JSON", () => {
    localStorage.setItem("test-str", "not-json-{{{");
    const result = loadLocalStorage("test-str", "fallback");
    expect(result).toBe("not-json-{{{");
  });

  it("returns fallback when localStorage.getItem throws", () => {
    const mock = {
      getItem: vi.fn(() => {
        throw new Error("security error");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };
    vi.stubGlobal("localStorage", mock);
    expect(loadLocalStorage("key", "safe")).toBe("safe");
    vi.unstubAllGlobals();
  });
});

// ── saveLocalStorage ────────────────────────────────────────────────────────

describe("saveLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores a string value as-is", () => {
    saveLocalStorage("s-key", "hello");
    expect(localStorage.getItem("s-key")).toBe("hello");
  });

  it("stores an object as JSON", () => {
    saveLocalStorage("o-key", { a: 1 });
    expect(localStorage.getItem("o-key")).toBe('{"a":1}');
  });

  it("removes the key when value is null", () => {
    localStorage.setItem("r-key", "bye");
    saveLocalStorage("r-key", null);
    expect(localStorage.getItem("r-key")).toBeNull();
  });

  it("emits console.warn when localStorage.setItem throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };
    vi.stubGlobal("localStorage", mock);
    saveLocalStorage("big-key", "big value");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("big-key"),
      expect.any(Error),
    );
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });
});
