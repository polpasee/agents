// ── Origin allowlist for Next.js route handlers ─────────────
//
// The previous WebSocket server enforced an origin allowlist in
// `verifyClient` against `next.config.ts::allowedDevOrigins`. After the
// SSE migration the WS process is gone, but `next dev --hostname 0.0.0.0`
// still exposes routes to LAN devices. Mirror the same dev allowlist here
// so route handlers reject unknown origins.
//
// Rules:
//  - Missing Origin header → allow (curl, server-side internal calls).
//  - Origin host is localhost / 127.0.0.1 → allow on any port.
//  - Origin host is a private/RFC1918 LAN address → allow on any port.
//  - Anything else → reject.

/** True when `host` matches the dev-mode LAN allowlist (mirror of
 *  `next.config.ts::allowedDevOrigins`). */
function isPrivateLanHost(host: string): boolean {
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 172.16.0.0/12 — second octet 16-31
  const m = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function isAllowedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname; // IPv6 literals retain brackets: "[::1]"
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]")
    return true;
  if (isPrivateLanHost(host)) return true;
  return false;
}

/** Stricter check for state-changing requests (POST/DELETE). Browsers always
 *  send an Origin header on these, so a present + allowlisted Origin is
 *  required: this closes a simple-request CSRF vector that the GET-friendly
 *  "missing Origin allowed" rule would otherwise leave open. */
export function isAllowedMutatingOrigin(request: Request): boolean {
  if (!request.headers.get("origin")) return false;
  return isAllowedRequestOrigin(request);
}
