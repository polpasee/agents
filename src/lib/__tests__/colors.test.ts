import { describe, it, expect } from "vitest";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS, UI } from "../colors";
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
