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

  it("STALE_THRESHOLD_MS <= DISCOVERY_THRESHOLD_MS", () => {
    // Equal is fine: once a file ages past both, discovery stops picking it
    // up and stale removal takes over. Strict less-than caused churn when
    // the two thresholds were set to the same value intentionally.
    expect(config.STALE_THRESHOLD_MS).toBeLessThanOrEqual(
      config.DISCOVERY_THRESHOLD_MS,
    );
  });

  it("STATUS_RUNNING_THRESHOLD_MS < STATUS_IDLE_THRESHOLD_MS", () => {
    expect(config.STATUS_RUNNING_THRESHOLD_MS).toBeLessThan(
      config.STATUS_IDLE_THRESHOLD_MS,
    );
  });

  it("POLL_INTERVAL_MS > 0", () => {
    expect(config.POLL_INTERVAL_MS).toBeGreaterThan(0);
  });
});
