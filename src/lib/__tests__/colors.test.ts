import { describe, it, expect } from "vitest";
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
  colorFromString,
  agentColor,
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

describe("colorFromString", () => {
  it("returns the same color for the same string", () => {
    expect(colorFromString("api-builder")).toBe(colorFromString("api-builder"));
  });

  it("returns different colors for different strings", () => {
    expect(colorFromString("api-builder")).not.toBe(colorFromString("frontend-ui"));
  });

  it("returns a valid HSL string", () => {
    expect(colorFromString("db-reader")).toMatch(/^hsl\(\d+, 75%, 65%\)$/);
  });
});

describe("agentColor", () => {
  it("hashes displayType when present (sub-agent with specific name)", () => {
    const a = { agentType: "build" as const, displayType: "api-builder" };
    const b = { agentType: "build" as const, displayType: "frontend-ui" };
    // Both are agentType="build" but different displayType → different colors
    expect(agentColor(a)).not.toBe(agentColor(b));
    expect(agentColor(a)).toBe(colorFromString("api-builder"));
  });

  it("falls back to AGENT_COLORS[agentType] when displayType is absent (main agents)", () => {
    expect(agentColor({ agentType: "main", displayType: undefined }))
      .toBe(AGENT_COLORS.main);
    expect(agentColor({ agentType: "main" }))
      .toBe(AGENT_COLORS.main);
  });
});
