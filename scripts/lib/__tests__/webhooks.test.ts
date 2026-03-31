import { describe, it, expect } from "vitest";
import { formatSlackMessage, formatDiscordMessage } from "../webhooks";

const mockPayload = {
  eventType: "error" as const,
  agentId: "agent-1",
  agentType: "explore",
  message: "Agent encountered an error",
  timestamp: 1711500000000,
};
const mockTime = "2024-03-27T06:40:00.000Z";

describe("formatSlackMessage", () => {
  it("returns a Slack block message with emoji", () => {
    const result = formatSlackMessage(mockPayload, mockTime) as Record<string, unknown>;
    expect(result.text).toContain(":x:");
    expect(result.text).toContain("Agent Monitor");
    expect(result.blocks).toBeDefined();
  });

  it("uses warning emoji for budget_exceeded", () => {
    const result = formatSlackMessage({ ...mockPayload, eventType: "budget_exceeded" }, mockTime) as Record<string, unknown>;
    expect(result.text).toContain(":warning:");
  });

  it("uses check emoji for agent_complete", () => {
    const result = formatSlackMessage({ ...mockPayload, eventType: "agent_complete" }, mockTime) as Record<string, unknown>;
    expect(result.text).toContain(":white_check_mark:");
  });
});

describe("formatDiscordMessage", () => {
  it("returns a Discord embed with color", () => {
    const result = formatDiscordMessage(mockPayload, mockTime) as Record<string, unknown>;
    expect(result.embeds).toBeDefined();
    const embeds = result.embeds as Array<Record<string, unknown>>;
    expect(embeds[0].color).toBe(0xff4444);
  });

  it("uses yellow color for budget_exceeded", () => {
    const result = formatDiscordMessage({ ...mockPayload, eventType: "budget_exceeded" }, mockTime) as Record<string, unknown>;
    const embeds = result.embeds as Array<Record<string, unknown>>;
    expect(embeds[0].color).toBe(0xeab308);
  });
});
