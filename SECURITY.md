# Security Policy

## Threat Model

This is a **localhost-only developer tool**. The Next.js server (`npm run dev`) binds to `0.0.0.0:4000`, making the dashboard reachable from private/LAN devices (e.g. a phone on the same WiFi). There is no separate WebSocket process — live state is delivered over Server-Sent Events (SSE) on `GET /api/stream`. Route handlers enforce an origin allowlist via `scripts/lib/origin-check.ts`, which mirrors `next.config.ts::allowedDevOrigins` and permits only localhost and private/RFC1918 LAN origins. The same checks **also enforce a `Host`-header allowlist** (the identical loopback + RFC1918 set, port stripped) as a DNS-rebinding defense: a rebinding attack resolving an attacker domain to `127.0.0.1` would send `Origin:null`/absent (allowed on reads) with `Host:attacker.com`, which the Host gate now rejects. A **missing `Host` header is allowed** (mirroring the missing-`Origin` rule) so internal/server-side callers are unaffected. Out of scope: remote attackers, multi-tenant deployments, public network exposure, or internet-facing use.

`origin-check.ts` exposes two checks, applied per route by risk:

- **`isAllowedRequestOrigin`** — used on read-only routes (`GET /api/stream`, `/api/logs/[agentId]`, `/api/costs`, `/api/usage`). A **missing `Origin` header is allowed by design** so that server-side and CLI clients (e.g. `curl`) can reach these routes; a present `Origin` must still be allowlisted.
- **`isAllowedMutatingOrigin`** — used on the state-changing annotation routes (`POST /api/annotations`, `DELETE /api/annotations/[id]`). This requires a **present, allowlisted `Origin`**: browsers always send `Origin` on these requests, so rejecting a missing one closes a simple-request CSRF vector that the read-route "missing Origin allowed" rule would otherwise leave open.

## Sensitive Data

Claude Code transcripts contain raw conversation history including:
- Tool inputs and outputs (Bash commands, file contents from Read tool calls, URLs with auth tokens)
- Inter-agent communication and decision logs

The SSE stream broadcasts this data **verbatim and unredacted** to every connected dashboard client. **Do not deploy this dashboard publicly or expose port 4000 to untrusted networks.**

## Supply Chain

Previous versions spawned `npx -y ccstatusline@latest` without pinning, exposing the project to arbitrary code execution via dependency substitution. Sprint 1 pins `ccstatusline@2.2.12` in `package.json` and filters environment variables passed to spawned processes. If you fork or modify the `/api/usage` route, do not restore the unpinned `npx -y` pattern.

## Reporting Vulnerabilities

Report security vulnerabilities via a private GitHub security advisory or contact the maintainer through the issue tracker. Do not disclose vulnerabilities publicly until a fix is available.

## Known Limitations (Post-Sprint-1)

The transitive dependency `postcss<8.5.10` remains as a build-time dependency via `@tailwindcss/postcss`. This does not affect runtime security but should be addressed in the next major upgrade when `@tailwindcss/postcss` releases a patched version.

## Dependency Audit Gate

CI runs `npm audit --audit-level=critical` (see `.github/workflows/ci.yml`). The gate is intentionally set to `critical` rather than `high`: the only outstanding `high` advisory is **GHSA-26hh-7cqf-hhc6** (a Next.js middleware/proxy bypass) which has no stable fix yet (canary-only) and does not apply here — this app ships no Next.js middleware. The gate should be reverted to `high` once a stable Next.js 16.3.x release lands.
