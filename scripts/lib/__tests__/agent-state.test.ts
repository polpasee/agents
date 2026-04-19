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

