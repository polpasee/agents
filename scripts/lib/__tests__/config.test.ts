import { describe, it, expect } from "vitest";
import * as config from "../config";

describe("config", () => {
  it("all thresholds are positive numbers", () => {
    const thresholds = [
      config.STATUS_RUNNING_THRESHOLD_MS,
      config.STATUS_IDLE_THRESHOLD_MS,
      config.DISCOVERY_THRESHOLD_MS,
      config.STALE_THRESHOLD_MS,
      config.REMOVED_IDS_TTL_MS,
    ];

    for (const t of thresholds) {
      expect(t).toBeGreaterThan(0);
      expect(typeof t).toBe("number");
    }
  });

  it("STALE_THRESHOLD_MS < DISCOVERY_THRESHOLD_MS", () => {
    expect(config.STALE_THRESHOLD_MS).toBeLessThan(
      config.DISCOVERY_THRESHOLD_MS,
    );
  });

  it("STATUS_RUNNING_THRESHOLD_MS < STATUS_IDLE_THRESHOLD_MS", () => {
    expect(config.STATUS_RUNNING_THRESHOLD_MS).toBeLessThan(
      config.STATUS_IDLE_THRESHOLD_MS,
    );
  });

  it("WS_PORT is a valid port number (1-65535)", () => {
    expect(config.WS_PORT).toBeGreaterThanOrEqual(1);
    expect(config.WS_PORT).toBeLessThanOrEqual(65535);
  });

  it("POLL_INTERVAL_MS > 0", () => {
    expect(config.POLL_INTERVAL_MS).toBeGreaterThan(0);
  });
});
