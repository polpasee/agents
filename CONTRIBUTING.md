# Contributing

Thanks for working on the Claude Agent Monitor. This is a Next.js 16 app that
serves the dashboard, runs a background JSONL poller, and streams live state to
the browser over Server-Sent Events (SSE). See [README.md](README.md) for the
architecture overview.

## Dev Loop

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (UI + background poller + SSE on port 4000)
npm run dev

# 3. Open the dashboard
open http://localhost:4000

# 4. (Optional) Seed mock agents so the topology has data to render
npm run mock-agents
```

There is no separate server process: the Next.js instrumentation hook
(`src/instrumentation.ts`) starts the poller that scans `~/.claude/projects` and
`~/.claude/teams`. No environment variables are required.

## Tests & Checks

```bash
npm test            # run the Vitest suite once
npm run test:watch  # watch mode
npm run type-check  # tsc --noEmit
npm run lint        # eslint .
npm run format      # prettier --write .  (or format:check to verify only)
npm run coverage    # tests with a coverage report
npm run build       # production build
```

Add or update tests under the nearest `__tests__/` directory when you change
behavior. The wire protocol lives in `src/lib/types.ts` — keep it in sync on
both the client (`src/`) and server (`scripts/`) sides.

## CI Gate

CI (`.github/workflows/ci.yml`) runs on every pull request and on pushes to
`main`, in this order. Run the equivalent locally before opening a PR:

1. `npm run type-check`
2. `npm run lint`
3. `npm run format:check`
4. `npm test -- --run`
5. `npm run coverage`
6. `npm run build`
7. `npm audit --audit-level=critical`

> The audit gate is set to `critical` (not `high`) because of the waived
> `high` advisory GHSA-26hh-7cqf-hhc6 — see [SECURITY.md](SECURITY.md).

## Branches & PRs

- Branch off `main`; keep changes focused and surgical.
- Match the existing code style (TypeScript strict mode, no unrequested
  refactors of adjacent code).
- Make sure the full CI sequence above passes before requesting review.
