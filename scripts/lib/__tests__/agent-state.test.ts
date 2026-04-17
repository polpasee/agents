import { describe, it, expect } from "vitest";
import { parseAgentType } from "../agent-state";

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
