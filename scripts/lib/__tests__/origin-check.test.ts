import { describe, it, expect } from "vitest";
import { isAllowedRequestOrigin, isAllowedHost } from "../origin-check";

function req(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  return new Request("http://localhost/api/x", { headers });
}

describe("isAllowedRequestOrigin", () => {
  it("allows requests with no Origin header (curl, server-side)", () => {
    expect(isAllowedRequestOrigin(req(undefined))).toBe(true);
  });

  it("allows localhost on any port", () => {
    expect(isAllowedRequestOrigin(req("http://localhost:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(req("http://localhost:8080"))).toBe(true);
  });

  it("allows 127.0.0.1 on any port", () => {
    expect(isAllowedRequestOrigin(req("http://127.0.0.1:3000"))).toBe(true);
  });

  it("allows RFC1918 LAN ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)", () => {
    expect(isAllowedRequestOrigin(req("http://10.0.0.5:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(req("http://192.168.1.42:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(req("http://172.16.0.1:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(req("http://172.20.5.5:3000"))).toBe(true);
    expect(isAllowedRequestOrigin(req("http://172.31.255.254:3000"))).toBe(
      true,
    );
  });

  it("rejects 172.x.x.x outside the 16-31 range", () => {
    expect(isAllowedRequestOrigin(req("http://172.15.0.1:3000"))).toBe(false);
    expect(isAllowedRequestOrigin(req("http://172.32.0.1:3000"))).toBe(false);
  });

  it("rejects public IPs and unknown hosts", () => {
    expect(isAllowedRequestOrigin(req("http://8.8.8.8:3000"))).toBe(false);
    expect(isAllowedRequestOrigin(req("http://example.com"))).toBe(false);
    expect(isAllowedRequestOrigin(req("https://evil.example"))).toBe(false);
  });

  it("rejects malformed origin values", () => {
    expect(isAllowedRequestOrigin(req("not-a-url"))).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isAllowedRequestOrigin(req("file://localhost"))).toBe(false);
  });

  it("allows IPv6 loopback ::1 (bracket notation)", () => {
    expect(isAllowedRequestOrigin(req("http://[::1]:4000"))).toBe(true);
  });

  it("allows IPv6 loopback ::1 without port", () => {
    expect(isAllowedRequestOrigin(req("http://[::1]"))).toBe(true);
  });

  it("still rejects a public IPv6 host", () => {
    expect(isAllowedRequestOrigin(req("http://[2001:db8::1]:3000"))).toBe(
      false,
    );
  });
});

function reqWithHost(host?: string, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (host !== undefined) headers.host = host;
  if (origin !== undefined) headers.origin = origin;
  return new Request("http://localhost/api/x", { headers });
}

describe("isAllowedHost / Host allowlist", () => {
  it("allows localhost Host on any port", () => {
    expect(isAllowedHost(reqWithHost("localhost:4000"))).toBe(true);
  });

  it("allows RFC1918 LAN Host on any port", () => {
    expect(isAllowedHost(reqWithHost("192.168.1.42:4000"))).toBe(true);
  });

  it("allows IPv6 loopback Host (bracket notation) with port", () => {
    expect(isAllowedHost(reqWithHost("[::1]:4000"))).toBe(true);
  });

  it("rejects an external Host", () => {
    expect(isAllowedHost(reqWithHost("evil.com"))).toBe(false);
    expect(isAllowedHost(reqWithHost("evil.com:4000"))).toBe(false);
  });

  it("blocks DNS-rebinding: bad Host + no Origin → request rejected", () => {
    expect(isAllowedRequestOrigin(reqWithHost("evil.com:4000"))).toBe(false);
  });

  it("still allows a legit localhost read (Host localhost, no Origin)", () => {
    expect(isAllowedRequestOrigin(reqWithHost("localhost"))).toBe(true);
  });
});
