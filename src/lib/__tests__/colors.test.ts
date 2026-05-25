import { describe, it, expect, beforeEach } from "vitest";
import {
  AGENT_COLORS,
  STATUS_COLORS,
  AGENT_LABELS,
  UI,
  TEAM_STATUS_COLORS,
  CHANGE_COLORS,
  ROLE_COLORS,
  ANNOTATION_COLOR,
  METRIC_COLORS,
  COMPARISON_COLORS,
  agentColor,
  assignAgentColor,
  resetAgentColorRegistry,
} from "../colors";
import type { AgentType, AgentStatus } from "../types";

const ALL_AGENT_TYPES: AgentType[] = [
  "main",
  "explore",
  "plan",
  "build",
  "review",
  "test",
  "team-lead",
  "generic",
];

const ALL_AGENT_STATUSES: AgentStatus[] = [
  "running",
  "waiting",
  "idle",
  "completed",
  "error",
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

describe("AGENT_COLORS", () => {
  it("has an entry for every AgentType", () => {
    for (const type of ALL_AGENT_TYPES) {
      expect(AGENT_COLORS).toHaveProperty(type);
    }
  });

  it("has no extra keys beyond AgentType values", () => {
    expect(Object.keys(AGENT_COLORS).sort()).toEqual(
      [...ALL_AGENT_TYPES].sort()
    );
  });

  it("has valid hex color strings", () => {
    for (const [type, color] of Object.entries(AGENT_COLORS)) {
      expect(color, `AGENT_COLORS["${type}"]`).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("AGENT_LABELS", () => {
  it("has an entry for every AgentType", () => {
    for (const type of ALL_AGENT_TYPES) {
      expect(AGENT_LABELS).toHaveProperty(type);
    }
  });

  it("has no extra keys beyond AgentType values", () => {
    expect(Object.keys(AGENT_LABELS).sort()).toEqual(
      [...ALL_AGENT_TYPES].sort()
    );
  });

  it("labels are non-empty strings", () => {
    for (const [type, label] of Object.entries(AGENT_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length, `AGENT_LABELS["${type}"] should be non-empty`).toBeGreaterThan(0);
    }
  });
});

describe("STATUS_COLORS", () => {
  it("has an entry for every AgentStatus", () => {
    for (const status of ALL_AGENT_STATUSES) {
      expect(STATUS_COLORS).toHaveProperty(status);
    }
  });

  it("has no extra keys beyond AgentStatus values", () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(
      [...ALL_AGENT_STATUSES].sort()
    );
  });

  it("has valid hex color strings", () => {
    for (const [status, color] of Object.entries(STATUS_COLORS)) {
      expect(color, `STATUS_COLORS["${status}"]`).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("UI color object", () => {
  it("has all expected top-level keys", () => {
    const expectedKeys = ["primary", "error", "tool", "cache", "text", "model"];
    for (const key of expectedKeys) {
      expect(UI).toHaveProperty(key);
    }
  });

  it("top-level simple colors are valid hex strings", () => {
    expect(UI.primary).toMatch(HEX_COLOR_RE);
    expect(UI.error).toMatch(HEX_COLOR_RE);
    expect(UI.tool).toMatch(HEX_COLOR_RE);
    expect(UI.model).toMatch(HEX_COLOR_RE);
  });

  it("cache sub-object has read and write hex colors", () => {
    expect(UI.cache).toHaveProperty("read");
    expect(UI.cache).toHaveProperty("write");
    expect(UI.cache.read).toMatch(HEX_COLOR_RE);
    expect(UI.cache.write).toMatch(HEX_COLOR_RE);
  });

  it("text sub-object has all expected keys with hex colors", () => {
    const textKeys = ["primary", "secondary", "muted", "dimmed", "empty"];
    for (const key of textKeys) {
      expect(UI.text).toHaveProperty(key);
      expect(
        (UI.text as Record<string, string>)[key],
        `UI.text.${key}`
      ).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("TEAM_STATUS_COLORS", () => {
  const EXPECTED_KEYS = ["forming", "active", "completed", "error"];

  it("has all expected team status keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(TEAM_STATUS_COLORS).toHaveProperty(key);
    }
  });

  it("has valid hex color strings", () => {
    for (const [key, color] of Object.entries(TEAM_STATUS_COLORS)) {
      expect(color, `TEAM_STATUS_COLORS["${key}"]`).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("CHANGE_COLORS", () => {
  const EXPECTED_KEYS = ["create", "edit", "delete"];

  it("has all expected change type keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(CHANGE_COLORS).toHaveProperty(key);
    }
  });

  it("has valid hex color strings", () => {
    for (const [key, color] of Object.entries(CHANGE_COLORS)) {
      expect(color, `CHANGE_COLORS["${key}"]`).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("ROLE_COLORS", () => {
  const EXPECTED_KEYS = ["user", "assistant", "system", "default"];

  it("has all expected role keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(ROLE_COLORS).toHaveProperty(key);
    }
  });

  it("has valid hex color strings", () => {
    for (const [key, color] of Object.entries(ROLE_COLORS)) {
      expect(color, `ROLE_COLORS["${key}"]`).toMatch(HEX_COLOR_RE);
    }
  });
});

describe("ANNOTATION_COLOR", () => {
  it("is a valid hex color string", () => {
    expect(ANNOTATION_COLOR).toMatch(HEX_COLOR_RE);
  });
});

describe("METRIC_COLORS", () => {
  it("has active and cost keys with valid hex colors", () => {
    expect(METRIC_COLORS.active).toMatch(HEX_COLOR_RE);
    expect(METRIC_COLORS.cost).toMatch(HEX_COLOR_RE);
  });
});

describe("COMPARISON_COLORS", () => {
  it("has better and worse keys with valid hex colors", () => {
    expect(COMPARISON_COLORS.better).toMatch(HEX_COLOR_RE);
    expect(COMPARISON_COLORS.worse).toMatch(HEX_COLOR_RE);
  });
});

describe("assignAgentColor", () => {
  beforeEach(() => resetAgentColorRegistry());

  it("returns the same color for the same id across calls", () => {
    expect(assignAgentColor("agent-1")).toBe(assignAgentColor("agent-1"));
  });

  it("gives distinct ids distinct colors until the palette is exhausted", () => {
    const seen = new Set<string>();
    // 12-slot palette (amber [main], red, rose, yellow excluded). All distinct ids should be unique.
    for (let i = 0; i < 12; i++) seen.add(assignAgentColor(`agent-${i}`));
    expect(seen.size).toBe(12);
  });

  it("cycles after the palette fills (slot 0 → palette[11], slot 12 → palette[11] again)", () => {
    const first = assignAgentColor("agent-0"); // slot 0 → palette[11] (end-backwards)
    for (let i = 1; i < 12; i++) assignAgentColor(`agent-${i}`);
    expect(assignAgentColor("agent-12")).toBe(first); // slot 12 wraps back to slot 0
    // Verify slot 0 is indeed the last palette entry (end-backwards order)
    expect(first).toBe("#f472b6"); // TW.pink400 — palette[11]
  });

  it("returns a 6-digit hex color (so alpha concatenation stays valid)", () => {
    expect(assignAgentColor("agent-x")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("never returns amber (main), red, rose, or yellow (reserved signals)", () => {
    for (let i = 0; i < 50; i++) {
      const c = assignAgentColor(`agent-${i}`).toLowerCase();
      expect(c).not.toBe("#fbbf24"); // TW.amber400 (main)
      expect(c).not.toBe("#f87171"); // TW.red400
      expect(c).not.toBe("#fb7185"); // TW.rose400
      expect(c).not.toBe("#facc15"); // TW.yellow400
    }
  });
});

describe("agentColor", () => {
  beforeEach(() => resetAgentColorRegistry());

  it("returns the reserved orange for any main agent regardless of id", () => {
    expect(agentColor({ id: "main-1", agentType: "main" })).toBe(AGENT_COLORS.main);
    expect(agentColor({ id: "main-2", agentType: "main" })).toBe(AGENT_COLORS.main);
  });

  it("gives two sub-agents with the same displayType different colors (per-instance)", () => {
    const a = { id: "agent-a", agentType: "build" as const };
    const b = { id: "agent-b", agentType: "build" as const };
    expect(agentColor(a)).not.toBe(agentColor(b));
  });

  it("returns a stable color for the same id across calls", () => {
    const a = { id: "agent-stable", agentType: "build" as const };
    expect(agentColor(a)).toBe(agentColor(a));
  });

  it("uses slug as key when id is empty, giving distinct slugs distinct colors", () => {
    const a = agentColor({ id: "", agentType: "review" as const, slug: "silent-failure-hunter" });
    const b = agentColor({ id: "", agentType: "review" as const, slug: "pr-test-analyzer" });
    expect(a).toMatch(HEX_COLOR_RE);
    expect(b).toMatch(HEX_COLOR_RE);
    expect(a).not.toBe(b);
    // same slug must be stable
    expect(agentColor({ id: "", agentType: "review" as const, slug: "silent-failure-hunter" })).toBe(a);
  });

  it("uses displayType as key when id and slug are both empty", () => {
    const a = agentColor({ id: "", agentType: "review" as const, slug: "", displayType: "dt-alpha" });
    const b = agentColor({ id: "", agentType: "review" as const, slug: "", displayType: "dt-beta" });
    expect(a).toMatch(HEX_COLOR_RE);
    expect(b).toMatch(HEX_COLOR_RE);
    expect(a).not.toBe(b);
  });

  it("returns UI.text.secondary when id, slug, and displayType are all empty", () => {
    expect(agentColor({ id: "", agentType: "explore" as const, slug: "", displayType: "" })).toBe(UI.text.secondary);
  });

  it("three sibling 'review' agents with distinct ids never share a color", () => {
    const colors = [
      agentColor({ id: "silent-failure-hunter", agentType: "review" as const }),
      agentColor({ id: "pr-test-analyzer", agentType: "review" as const }),
      agentColor({ id: "code-reviewer", agentType: "review" as const }),
    ];
    const unique = new Set(colors);
    expect(unique.size).toBe(3);
  });
});
