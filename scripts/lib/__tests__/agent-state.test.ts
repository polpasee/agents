import { describe, it, expect, beforeEach } from "vitest";
import {
  parseAgentType,
  registerAgent,
  processEntry,
  updateAgentStatus,
  agents,
} from "../agent-state";

describe("parseAgentType", () => {
  it('returns "explore" for "explore"', () => {
    expect(parseAgentType("explore")).toBe("explore");
  });

  it('returns "explore" for "Explore codebase"', () => {
    expect(parseAgentType("Explore codebase")).toBe("explore");
  });

  it('returns "plan" for "plan"', () => {
    expect(parseAgentType("plan")).toBe("plan");
  });

  it('returns "build" for "build"', () => {
    expect(parseAgentType("build")).toBe("build");
  });

  it('returns "build" for "code-architect"', () => {
    expect(parseAgentType("code-architect")).toBe("build");
  });

  it('returns "build" for "code-simplifier"', () => {
    expect(parseAgentType("code-simplifier")).toBe("build");
  });

  it('returns "review" for "review"', () => {
    expect(parseAgentType("review")).toBe("review");
  });

  it('returns "review" for "code-review"', () => {
    expect(parseAgentType("code-review")).toBe("review");
  });

  it('returns "test" for "test"', () => {
    expect(parseAgentType("test")).toBe("test");
  });

  it('returns "test" for "pr-test"', () => {
    expect(parseAgentType("pr-test")).toBe("test");
  });

  it('returns "team-lead" for "team-lead"', () => {
    expect(parseAgentType("team-lead")).toBe("team-lead");
  });

  it('returns "generic" for undefined', () => {
    expect(parseAgentType(undefined)).toBe("generic");
  });

  it('returns "generic" for empty string', () => {
    expect(parseAgentType("")).toBe("generic");
  });

  it('returns "generic" for unrecognized string', () => {
    expect(parseAgentType("random-string")).toBe("generic");
  });

  it('returns "review" for "security-auditor"', () => {
    expect(parseAgentType("security-auditor")).toBe("review");
  });

  it('returns "review" for "architect-review"', () => {
    expect(parseAgentType("architect-review")).toBe("review");
  });

  it('returns "build" for "frontend-ui"', () => {
    expect(parseAgentType("frontend-ui")).toBe("build");
  });

  it('returns "build" for "api-builder"', () => {
    expect(parseAgentType("api-builder")).toBe("build");
  });

  it('returns "explore" for "db-reader"', () => {
    expect(parseAgentType("db-reader")).toBe("explore");
  });

  it('returns "explore" for "Performance analysis"', () => {
    expect(parseAgentType("Performance analysis")).toBe("explore");
  });

  it('returns "build" for "Fix consumer pages"', () => {
    expect(parseAgentType("Fix consumer pages")).toBe("build");
  });

  it('returns "plan" for "architect"', () => {
    expect(parseAgentType("architect")).toBe("plan");
  });

  it('returns "generic" for "general-purpose"', () => {
    expect(parseAgentType("general-purpose")).toBe("generic");
  });

  it('does not match "fix" inside "prefix"', () => {
    expect(parseAgentType("prefix-helper")).toBe("generic");
  });

  // Plugin agent names from CLAUDE.md cheatsheet
  it('returns "build" for "voltagent-core-dev:websocket-engineer"', () => {
    expect(parseAgentType("voltagent-core-dev:websocket-engineer")).toBe("build");
  });

  it('returns "build" for "voltagent-lang:react-specialist"', () => {
    expect(parseAgentType("voltagent-lang:react-specialist")).toBe("build");
  });

  it('returns "build" for "voltagent-lang:nextjs-developer"', () => {
    expect(parseAgentType("voltagent-lang:nextjs-developer")).toBe("build");
  });

  it('returns "build" for "voltagent-lang:typescript-pro"', () => {
    expect(parseAgentType("voltagent-lang:typescript-pro")).toBe("build");
  });

  it('returns "build" for "voltagent-data-ai:postgres-pro"', () => {
    expect(parseAgentType("voltagent-data-ai:postgres-pro")).toBe("build");
  });

  it('returns "build" for "voltagent-data-ai:database-optimizer"', () => {
    expect(parseAgentType("voltagent-data-ai:database-optimizer")).toBe("build");
  });

  it('returns "build" for "voltagent-lang:sql-pro"', () => {
    expect(parseAgentType("voltagent-lang:sql-pro")).toBe("build");
  });

  it('returns "build" for "voltagent-core-dev:fullstack-developer"', () => {
    expect(parseAgentType("voltagent-core-dev:fullstack-developer")).toBe("build");
  });

  it('returns "build" for "voltagent-core-dev:ui-designer"', () => {
    // ui-designer is listed under Build in CLAUDE.md; carve-out before "design" → plan
    expect(parseAgentType("voltagent-core-dev:ui-designer")).toBe("build");
  });

  it('returns "test" for "agent-skills:test-engineer"', () => {
    // "test" keyword wins before "engineer"
    expect(parseAgentType("agent-skills:test-engineer")).toBe("test");
  });

  it('returns "test" for "voltagent-qa-sec:test-automator"', () => {
    expect(parseAgentType("voltagent-qa-sec:test-automator")).toBe("test");
  });

  it('returns "test" for "voltagent-qa-sec:ui-ux-tester"', () => {
    expect(parseAgentType("voltagent-qa-sec:ui-ux-tester")).toBe("test");
  });

  it('returns "review" for "agent-skills:code-reviewer"', () => {
    expect(parseAgentType("agent-skills:code-reviewer")).toBe("review");
  });

  it('returns "review" for "agent-skills:security-auditor"', () => {
    expect(parseAgentType("agent-skills:security-auditor")).toBe("review");
  });

  it('returns "review" for "pr-review-toolkit:silent-failure-hunter"', () => {
    expect(parseAgentType("pr-review-toolkit:silent-failure-hunter")).toBe("review");
  });

  it('returns "review" for "pr-review-toolkit:type-design-analyzer"', () => {
    // "review" wins over "design" and "analy" because review check comes first
    expect(parseAgentType("pr-review-toolkit:type-design-analyzer")).toBe("review");
  });

  it('returns "review" for "pr-review-toolkit:pr-test-analyzer"', () => {
    // "review" (from toolkit prefix) wins over "test"
    expect(parseAgentType("pr-review-toolkit:pr-test-analyzer")).toBe("review");
  });

  it('returns "build" for "voltagent-qa-sec:performance-engineer"', () => {
    // No review/test signal; falls through to engineer → build
    expect(parseAgentType("voltagent-qa-sec:performance-engineer")).toBe("build");
  });

  it('returns "build" for "feature-dev:code-architect" (regression)', () => {
    // Existing carve-out: compound "code-architect" resolves to build, not plan
    expect(parseAgentType("feature-dev:code-architect")).toBe("build");
  });

  it('returns "explore" for "feature-dev:code-explorer"', () => {
    expect(parseAgentType("feature-dev:code-explorer")).toBe("explore");
  });

  it('returns "build" for "voltagent-dev-exp:documentation-engineer"', () => {
    // engineer → build wins; no "doc" category exists
    expect(parseAgentType("voltagent-dev-exp:documentation-engineer")).toBe("build");
  });

  it('returns "generic" for "voltagent-dev-exp:git-workflow-manager"', () => {
    // No recognisable signal in the slug
    expect(parseAgentType("voltagent-dev-exp:git-workflow-manager")).toBe("generic");
  });

  it('returns "review" for "failure-hunter"', () => {
    expect(parseAgentType("failure-hunter")).toBe("review");
  });

  it('returns "review" for "type-design-analyzer"', () => {
    expect(parseAgentType("type-design-analyzer")).toBe("review");
  });
});

describe("processEntry: lazy model learning", () => {
  beforeEach(() => {
    agents.clear();
  });

  it("fills in agent.model when an assistant message carries it", () => {
    registerAgent({
      agentId: "a1",
      sessionId: "a1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "", // not yet known at registration time
      startTime: Date.now(),
    });
    expect(agents.get("a1")?.model).toBe("");

    processEntry(
      {
        timestamp: new Date().toISOString(),
        message: { role: "assistant", model: "claude-opus-4-7", content: [] },
      },
      "a1",
      "a1",
    );

    expect(agents.get("a1")?.model).toBe("claude-opus-4-7");
  });

  it("demotes to idle when mtime is already old at first check", () => {
    // Reproduces the stuck-on-running bug: if an agent is registered while
    // its JSONL mtime is already > STATUS_IDLE_THRESHOLD_MS old, the old
    // narrow-window branch never fired and status was frozen at "running".
    registerAgent({
      agentId: "a1",
      sessionId: "a1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: Date.now() - 10 * 60 * 1000,
    });
    expect(agents.get("a1")?.status).toBe("running");

    // Feed in an mtime 10 minutes in the past — well beyond any threshold
    updateAgentStatus("a1", Date.now() - 10 * 60 * 1000);
    expect(agents.get("a1")?.status).toBe("idle");
  });

  it("does not flip idle/running when called with mixed fresh and stale mtimes in one cycle", () => {
    // Reproduces the 2s idle↔running oscillation: during a single poll, discovery
    // calls updateAgentStatus with the main's own (stale) mtime AND with the
    // fresh mtime of an active sub-agent. Once we have observed a fresh write
    // for this agent, a later call with a stale mtime in the same poll must NOT
    // demote it back to idle — the max of all writes is what defines activity.
    registerAgent({
      agentId: "main1",
      sessionId: "main1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: Date.now(),
    });

    // Sub-agent just wrote: fresh mtime flows in (discovery.ts:180)
    updateAgentStatus("main1", Date.now() - 500);
    expect(agents.get("main1")?.status).toBe("running");

    // Next poll: main's own JSONL is still parked (stale), fed first (discovery.ts:115)
    updateAgentStatus("main1", Date.now() - 2 * 60 * 1000);
    expect(agents.get("main1")?.status).toBe("running");

    // Sub writes again, still fresh
    updateAgentStatus("main1", Date.now() - 300);
    expect(agents.get("main1")?.status).toBe("running");
  });

  it("updates model when the user switches mid-session (Sonnet → Opus)", () => {
    registerAgent({
      agentId: "a1",
      sessionId: "a1",
      projectDir: "proj",
      agentType: "main",
      task: "session",
      slug: "",
      model: "claude-sonnet-4-6",
      startTime: Date.now(),
    });

    processEntry(
      {
        timestamp: new Date().toISOString(),
        message: { role: "assistant", model: "claude-opus-4-7", content: [] },
      },
      "a1",
      "a1",
    );

    expect(agents.get("a1")?.model).toBe("claude-opus-4-7");
  });
});

describe("registerAgent: project label", () => {
  beforeEach(() => {
    agents.clear();
  });

  it("collapses macOS /private/{tmp,var,etc} symlink prefix on the label only", () => {
    registerAgent({
      agentId: "m1",
      sessionId: "m1",
      projectDir: "-private-tmp",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: Date.now(),
    });
    const md = agents.get("m1")?.metadata;
    expect(md?.projectName).toBe("tmp");
    expect(md?.projectDir).toBe("-private-tmp"); // canonical id preserved
  });

  it("does not strip 'private' when it's part of a real project path", () => {
    registerAgent({
      agentId: "m2",
      sessionId: "m2",
      projectDir: "-Users-erdos-private-notes",
      agentType: "main",
      task: "session",
      slug: "",
      model: "",
      startTime: Date.now(),
    });
    expect(agents.get("m2")?.metadata?.projectName).toBe("Users/erdos/private/notes");
  });
});

