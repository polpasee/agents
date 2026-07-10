import { describe, it, expect } from "vitest";
import { selectStaleAgentIds } from "../pruning";
import {
  EXTERNAL_AGENT_ID_PREFIX,
  SUBAGENT_STALE_THRESHOLD_MS,
  MAX_EXTERNAL_RUN_MS,
} from "../config";

describe("selectStaleAgentIds — external (Codex) node gating", () => {
  const externalId = `${EXTERNAL_AGENT_ID_PREFIX}toolu_1`;
  // One sub-agent stale window past its last activity.
  const oldMtime = (now: number) =>
    now - (SUBAGENT_STALE_THRESHOLD_MS + 10_000);

  it("never reaps a still-running external node mid-run, even past the threshold", () => {
    const now = Date.now();
    const agents = new Map([
      [
        externalId,
        { parentId: "main1", status: "running", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([[externalId, oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("reaps a stuck running external node past the grace window", () => {
    const now = Date.now();
    const agents = new Map([
      [
        externalId,
        {
          parentId: "main1",
          status: "running",
          startTime: now - (MAX_EXTERNAL_RUN_MS + 60_000),
        },
      ],
    ]);
    const mtimes = new Map([[externalId, oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([externalId]);
  });

  it("ages out an idle external node once it is past the threshold", () => {
    const now = Date.now();
    const agents = new Map([
      [
        externalId,
        { parentId: "main1", status: "idle", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([[externalId, oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([externalId]);
  });

  it("ages out an error external node once it is past the threshold", () => {
    const now = Date.now();
    const agents = new Map([
      [
        externalId,
        { parentId: "main1", status: "error", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([[externalId, oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([externalId]);
  });

  it("prunes a non-external completed node once past its stale threshold (push lifecycle: SubagentStop/SessionEnd age out like any other terminal node)", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "completed", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["child1"]);
  });

  it("does not prune a completed node still within its stale threshold — lets the completion chime/animation play first", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "completed", startTime: now - 1_000 },
      ],
    ]);
    const mtimes = new Map([["child1", now - 1_000]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("prunes a non-external error node once past its stale threshold", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "error", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["child1"]);
  });

  it("never prunes a waiting node, no matter how stale", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "waiting", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", now - 100 * 60 * 60 * 1000]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("does not reap a running non-external child mid-run (within the run window)", () => {
    // Push/seed nodes have no file to refresh their clock; a running node whose
    // single long tool emits no interim hook must survive until a terminal
    // event or the run-window bound, not be purged at the 60s stale threshold.
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "running", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("reaps a running non-external node past the run window (zombie clear)", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        {
          parentId: "main1",
          status: "running",
          startTime: now - (MAX_EXTERNAL_RUN_MS + 60_000),
        },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["child1"]);
  });
});
