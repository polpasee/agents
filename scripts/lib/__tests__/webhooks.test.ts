import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import {
  formatSlackMessage,
  formatDiscordMessage,
  dispatchWebhooks,
  getWebhookConfigs,
  loadWebhookConfig,
} from "../webhooks";

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
    const result = formatSlackMessage(mockPayload, mockTime) as Record<
      string,
      unknown
    >;
    expect(result.text).toContain(":x:");
    expect(result.text).toContain("Agent Monitor");
    expect(result.blocks).toBeDefined();
  });

  it("uses warning emoji for budget_exceeded", () => {
    const result = formatSlackMessage(
      { ...mockPayload, eventType: "budget_exceeded" },
      mockTime,
    ) as Record<string, unknown>;
    expect(result.text).toContain(":warning:");
  });

  it("uses check emoji for agent_complete", () => {
    const result = formatSlackMessage(
      { ...mockPayload, eventType: "agent_complete" },
      mockTime,
    ) as Record<string, unknown>;
    expect(result.text).toContain(":white_check_mark:");
  });
});

describe("formatDiscordMessage", () => {
  it("returns a Discord embed with color", () => {
    const result = formatDiscordMessage(mockPayload, mockTime) as Record<
      string,
      unknown
    >;
    expect(result.embeds).toBeDefined();
    const embeds = result.embeds as Array<Record<string, unknown>>;
    // safe: embeds is defined per the expect above; index 0 is the first embed
    expect(embeds[0]!.color).toBe(0xff4444);
  });

  it("uses yellow color for budget_exceeded", () => {
    const result = formatDiscordMessage(
      { ...mockPayload, eventType: "budget_exceeded" },
      mockTime,
    ) as Record<string, unknown>;
    const embeds = result.embeds as Array<Record<string, unknown>>;
    // safe: embeds array always has at least one element per message format contract
    expect(embeds[0]!.color).toBe(0xeab308);
  });
});

describe("dispatchWebhooks — non-ok response", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a warning when the webhook endpoint returns 500", async () => {
    const configs = getWebhookConfigs();
    configs.push({
      url: "http://test.example/hook",
      events: ["error"],
      format: "generic",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    await dispatchWebhooks({ ...mockPayload });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/http:\/\/test\.example\/hook.*500/),
    );
    configs.pop();
    vi.unstubAllGlobals();
  });

  it("logs a warning when the webhook endpoint returns 403", async () => {
    const configs = getWebhookConfigs();
    configs.push({
      url: "http://test.example/hook2",
      events: ["error"],
      format: "generic",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );

    await dispatchWebhooks({ ...mockPayload });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("403"));
    configs.pop();
    vi.unstubAllGlobals();
  });

  it("does NOT warn when the webhook endpoint returns 200", async () => {
    const configs = getWebhookConfigs();
    configs.push({
      url: "http://test.example/hook3",
      events: ["error"],
      format: "generic",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );

    await dispatchWebhooks({ ...mockPayload });

    expect(console.warn).not.toHaveBeenCalled();
    configs.pop();
    vi.unstubAllGlobals();
  });
});

describe("loadWebhookConfig — missing vs corrupt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays silent when the config file is absent (ENOENT)", () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    });

    loadWebhookConfig();

    // No config is the normal case — no warning, and no configs loaded.
    expect(console.warn).not.toHaveBeenCalled();
    expect(getWebhookConfigs()).toEqual([]);
  });

  it("warns when the config file is corrupt JSON", () => {
    mockReadFileSync.mockReturnValue("{ not valid json");

    loadWebhookConfig();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load webhook config"),
      expect.anything(),
    );
    expect(getWebhookConfigs()).toEqual([]);
  });
});
