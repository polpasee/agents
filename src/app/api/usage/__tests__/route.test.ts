import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { GET } from "../route";

/** Request with no Origin header → allowed (mirrors curl / server-side). */
function req(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  return new Request("http://localhost/api/usage", { headers });
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/usage GET", () => {
  it("returns 403 for a disallowed cross-origin request", async () => {
    const res = await GET(req("http://evil.example.com"));
    expect(res.status).toBe(403);
    // Origin guard runs before any filesystem access.
    expect(mockStatSync).not.toHaveBeenCalled();
  });

  it("returns null payload silently when caches are missing (ENOENT)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // ccstatusline cache: stat throws ENOENT. legacy: readFile throws ENOENT.
    mockStatSync.mockImplementation(() => {
      throw enoent();
    });
    mockReadFileSync.mockImplementation(() => {
      throw enoent();
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
    // A missing cache is expected — no warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns (but still returns null) when the ccstatusline cache is corrupt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // ccstatusline cache stat succeeds but its content is invalid JSON; the
    // legacy fallback file is absent (ENOENT, stays silent).
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });
    // 1st read = ccstatusline cache (corrupt JSON); 2nd = legacy fallback (absent).
    mockReadFileSync
      .mockImplementationOnce(() => "{ not valid json")
      .mockImplementationOnce(() => {
        throw enoent();
      });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
    // Corrupt cache is a real signal — surfaced via console.warn exactly once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ccstatusline cache"),
      expect.anything(),
    );
  });
});
