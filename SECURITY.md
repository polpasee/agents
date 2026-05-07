# Security Policy

## Threat Model

This is a **localhost-only developer tool**. The WebSocket server binds to `127.0.0.1:4001` by default. Origin allowlist enforcement (configured in `scripts/lib/config.ts`) restricts connections to browser-only clients after Sprint 1 fixes. Out of scope: remote attackers, multi-tenant deployments, network exposure, or internet-facing use.

## Sensitive Data

Claude Code transcripts contain raw conversation history including:
- Tool inputs and outputs (Bash commands, file contents from Read tool calls, URLs with auth tokens)
- Inter-agent communication and decision logs

The WebSocket stream broadcasts this data **verbatim and unredacted** to every connected dashboard client. **Do not deploy this dashboard publicly or expose ports 4000/4001 to untrusted networks.**

## Supply Chain

Previous versions spawned `npx -y ccstatusline@latest` without pinning, exposing the project to arbitrary code execution via dependency substitution. Sprint 1 pins `ccstatusline@2.2.12` in `package.json` and filters environment variables passed to spawned processes. If you fork or modify the `/api/usage` route, do not restore the unpinned `npx -y` pattern.

## Reporting Vulnerabilities

Report security vulnerabilities via a private GitHub security advisory or contact the maintainer through the issue tracker. Do not disclose vulnerabilities publicly until a fix is available.

## Known Limitations (Post-Sprint-1)

The transitive dependency `postcss<8.5.10` remains as a build-time dependency via `@tailwindcss/postcss`. This does not affect runtime security but should be addressed in the next major upgrade when `@tailwindcss/postcss` releases a patched version.
