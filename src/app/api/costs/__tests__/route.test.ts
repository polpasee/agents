import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../../scripts/lib/cost-history", () => ({
  scanCostHistory: vi.fn(),
}));

import { GET } from "../route";
import { scanCostHistory } from "../../../../../scripts/lib/cost-history";

const mockScanCostHistory = vi.mocked(scanCostHistory);

describe("/api/costs GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with cost buckets on success", async () => {
    mockScanCostHistory.mockResolvedValue({ day: 1.5, week: 8.0, month: 20.0 });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ day: 1.5, week: 8.0, month: 20.0 });
  });

  it("returns 500 when scanCostHistory throws", async () => {
    mockScanCostHistory.mockRejectedValue(new Error("ENOENT"));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to read cost history");
  });
});
