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

  it("keeps a non-external completed node — real agents' terminal states stay protected", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "completed", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual([]);
  });

  it("still prunes a stale running non-external child (baseline unchanged)", () => {
    const now = Date.now();
    const agents = new Map([
      [
        "child1",
        { parentId: "main1", status: "running", startTime: now - 300_000 },
      ],
    ]);
    const mtimes = new Map([["child1", oldMtime(now)]]);

    expect(selectStaleAgentIds(agents, mtimes, now)).toEqual(["child1"]);
  });
});
