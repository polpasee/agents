import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fsp from "node:fs/promises";

// ── State maps (shared globalThis singletons) ─────────
import {
  agents,
  edges,
  removedAgentIds,
  registerAgent,
  parseAgentType,
} from "../agent-state";

import { discoverTeams } from "../teams-discovery";

// ── Helpers ───────────────────────────────────────────

const LEAD_SESSION_ID = "d6eb27b1-7c83-4516-b33b-80984f7e9268";
const LEAD_AGENT_ID = "team-lead@session-d6eb27b1";
const MEMBER_AGENT_ID = "capforecast@session-d6eb27b1";
const TEAM_NAME = "session-d6eb27b1";

/** Minimal config.json matching the real on-disk shape. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: TEAM_NAME,
    leadAgentId: LEAD_AGENT_ID,
    leadSessionId: LEAD_SESSION_ID,
    members: [
      {
        agentId: LEAD_AGENT_ID,
        name: "team-lead",
        agentType: "team-lead",
        joinedAt: 1781662802682,
        cwd: "/Users/erdos/Github/ipportal2",
      },
      {
        agentId: MEMBER_AGENT_ID,
        name: "capforecast",
        agentType: "voltagent-lang:nextjs-developer",
        model: "sonnet",
        joinedAt: 1781663336240,
        prompt: "Implement a feature...",
      },
    ],
    ...overrides,
  };
}

/** Create a fixture team directory tree under `teamsDir`. Returns the session subdir path. */
async function writeTeamFixture(
  teamsDir: string,
  sessionDir: string,
  config: object,
  inboxNames: string[] = [],
): Promise<string> {
  const sessionPath = path.join(teamsDir, sessionDir);
  await fsp.mkdir(path.join(sessionPath, "inboxes"), { recursive: true });
  await fsp.writeFile(path.join(sessionPath, "config.json"), JSON.stringify(config), "utf-8");
  for (const name of inboxNames) {
    await fsp.writeFile(path.join(sessionPath, "inboxes", `${name}.json`), "[]", "utf-8");
  }
  return sessionPath;
}

/** Seed a registered main agent for the lead session so teammates can attach. */
function seedLeadAgent(projectDir = "/Users/erdos/Github/ipportal2") {
  removedAgentIds.delete(LEAD_SESSION_ID);
  registerAgent({
    agentId: LEAD_SESSION_ID,
    sessionId: LEAD_SESSION_ID,
    projectDir,
    agentType: "main",
    task: "Main session",
    slug: "main-session",
    model: "claude-opus",
    startTime: 1781662800000,
  });
}

// ── Setup / teardown ──────────────────────────────────

let teamsDir: string;

beforeEach(async () => {
  // Fresh tmp dir per test
  teamsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "teams-discovery-test-"));

  // Clear shared state
  agents.clear();
  edges.length = 0;
  removedAgentIds.clear();
});

afterEach(async () => {
  // Remove the tmp dir
  await fsp.rm(teamsDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────

describe("discoverTeams", () => {
  it("registers a member as child of leadSessionId (parentId + edge present)", async () => {
    seedLeadAgent();
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig(), ["capforecast"]);

    await discoverTeams(teamsDir);

    expect(agents.has(MEMBER_AGENT_ID)).toBe(true);
    expect(agents.get(MEMBER_AGENT_ID)?.parentId).toBe(LEAD_SESSION_ID);
    const edgePresent = edges.some(
      (e) => e.source === LEAD_SESSION_ID && e.target === MEMBER_AGENT_ID,
    );
    expect(edgePresent).toBe(true);
  });

  it("does NOT register the lead member (no duplicate node for the lead)", async () => {
    seedLeadAgent();
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await discoverTeams(teamsDir);

    // The lead's agentId must not appear as a separate agent entry
    expect(agents.has(LEAD_AGENT_ID)).toBe(false);
    // The lead session IS present (seeded as main)
    expect(agents.has(LEAD_SESSION_ID)).toBe(true);
  });

  it("skips all members when leadSessionId is not a registered main", async () => {
    // Do NOT seed the lead agent
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await discoverTeams(teamsDir);

    expect(agents.has(MEMBER_AGENT_ID)).toBe(false);
    expect(agents.has(LEAD_AGENT_ID)).toBe(false);
  });

  it("inherits lead main's projectDir for the teammate", async () => {
    const projectDir = "/Users/erdos/Github/special-project";
    seedLeadAgent(projectDir);
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await discoverTeams(teamsDir);

    const member = agents.get(MEMBER_AGENT_ID);
    expect(member).toBeDefined();
    expect(member?.metadata?.projectDir).toBe(projectDir);
  });

  it("maps agentType, displayType, model, slug, startTime from member", async () => {
    seedLeadAgent();
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await discoverTeams(teamsDir);

    const member = agents.get(MEMBER_AGENT_ID);
    expect(member).toBeDefined();
    expect(member?.agentType).toBe(parseAgentType("voltagent-lang:nextjs-developer"));
    expect(member?.displayType).toBe("voltagent-lang:nextjs-developer");
    expect(member?.model).toBe("sonnet");
    expect(member?.slug).toBe("capforecast");
    expect(member?.startTime).toBe(1781663336240);
  });

  it("is idempotent: second call does not duplicate edges or members", async () => {
    seedLeadAgent();
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig(), ["capforecast"]);

    await discoverTeams(teamsDir);
    const agentCountAfterFirst = agents.size;
    const edgeCountAfterFirst = edges.length;

    await discoverTeams(teamsDir);

    expect(agents.size).toBe(agentCountAfterFirst);
    expect(edges.length).toBe(edgeCountAfterFirst);
  });

  it("does not throw on malformed config.json; sibling team is still processed", async () => {
    seedLeadAgent();

    // Bad team dir — invalid JSON
    const badDir = path.join(teamsDir, "session-bad");
    await fsp.mkdir(badDir, { recursive: true });
    await fsp.writeFile(path.join(badDir, "config.json"), "NOT JSON", "utf-8");

    // Good team dir alongside it
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await expect(discoverTeams(teamsDir)).resolves.toBeUndefined();
    // The good team's member was still registered
    expect(agents.has(MEMBER_AGENT_ID)).toBe(true);
  });

  it("does not throw on a missing config.json; other teams still processed", async () => {
    seedLeadAgent();

    // Dir with no config.json
    await fsp.mkdir(path.join(teamsDir, "session-missing"), { recursive: true });

    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());

    await expect(discoverTeams(teamsDir)).resolves.toBeUndefined();
    expect(agents.has(MEMBER_AGENT_ID)).toBe(true);
  });

  it("does not re-add a member absent from a later snapshot", async () => {
    seedLeadAgent();
    // First run: member is in config
    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, makeConfig());
    await discoverTeams(teamsDir);
    expect(agents.has(MEMBER_AGENT_ID)).toBe(true);

    // Simulate removal from config (member removed from members array)
    const configWithoutMember = {
      ...makeConfig(),
      members: [makeConfig().members[0]], // only lead remains
    };
    await fsp.writeFile(
      path.join(teamsDir, `session-${TEAM_NAME}`, "config.json"),
      JSON.stringify(configWithoutMember),
      "utf-8",
    );

    // Manually remove from agents to simulate stale-purge having fired
    agents.delete(MEMBER_AGENT_ID);

    // Second run: discoverTeams must NOT re-add the removed member
    await discoverTeams(teamsDir);
    expect(agents.has(MEMBER_AGENT_ID)).toBe(false);
  });

  it("handles a member with missing optional fields (model, prompt)", async () => {
    seedLeadAgent();
    const configNoModel = makeConfig();
    // Remove optional fields from member
    delete (configNoModel.members[1] as Record<string, unknown>).model;
    delete (configNoModel.members[1] as Record<string, unknown>).prompt;

    await writeTeamFixture(teamsDir, `session-${TEAM_NAME}`, configNoModel);

    await expect(discoverTeams(teamsDir)).resolves.toBeUndefined();
    const member = agents.get(MEMBER_AGENT_ID);
    expect(member).toBeDefined();
    expect(member?.model).toBe("");
  });
});
