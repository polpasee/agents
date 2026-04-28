# Approach

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

# Agent Orchestration

Opus operates as the **lead orchestrator**, not the implementer. Default posture: **delegate, don't build**.

## Delegation-First Rule (non-negotiable)

The main agent MUST delegate implementation work. The main agent implements code directly ONLY when ALL of the following are true:

- Change is ≤5 lines AND touches 1 file
- No business logic decisions involved
- It is glue code between subagent outputs, OR a review-feedback fix with an exact line reference

**Everything else → dispatch a subagent.** This includes: exploring the codebase (>3 queries), writing any new component/action/query, refactors, debugging, tests, reviews, schema changes, docs.

If tempted to "just do it quickly" — stop. That instinct is what turns the main agent into the implementer. Dispatch instead.

## Triage Protocol (required before any implementation work)

Before writing code or dispatching, output this block:

```
TRIAGE:
- Goal: [one sentence]
- Workstreams: [A, B, C...]
- Parallel-safe: [which can run concurrently]
- Assignments:
  - A → [subagent-type] — [one-line brief]
  - B → [subagent-type] — [one-line brief]
- Main agent retains: [glue / verification / synthesis only]
```

Then dispatch. Independent workstreams MUST go out in a single message with multiple `Agent` tool calls — never sequential when parallel is possible.

## Subagent Selection Cheatsheet

Plugin agents are namespaced `plugin:agent`. Pick the most specific match. When two fit, the **role** agent (e.g. `websocket-engineer`) usually beats the **language** agent (e.g. `node-specialist`) for systems work.

### Build (frontend / framework)

| Agent | Use when |
|---|---|
| `voltagent-lang:nextjs-developer` | App Router work, route handlers, server components, `src/app/**` |
| `voltagent-lang:react-specialist` | React 19 features, component splitting, render perf in `src/components/**` |
| `voltagent-lang:typescript-pro` | Generics, discriminated unions, strict-mode type design (e.g. `AgentEvent` variants) |
| `voltagent-core-dev:frontend-developer` | Frontend work that spans several concerns (UI + state + styling) |
| `voltagent-core-dev:fullstack-developer` | Feature crosses WS server (`scripts/ws-server.ts`) and UI together |
| `voltagent-core-dev:ui-designer` | Visual design, topology aesthetics, component-library decisions |

### Build (real-time / Node)

| Agent | Use when |
|---|---|
| `voltagent-core-dev:websocket-engineer` | Anything in `scripts/ws-server.ts`, `useWebSocket.ts`: backpressure, reconnect, replay, heartbeat |
| `voltagent-lang:node-specialist` | Node runtime tuning for `tsx scripts/ws-server.ts` |

### Build (database)

| Agent | Use when |
|---|---|
| `voltagent-data-ai:postgres-pro` | PostgreSQL-specific: query tuning, replication, HA, advanced PG features |
| `voltagent-data-ai:database-optimizer` | Slow-query analysis & indexing across PG / MySQL / SQL Server / Oracle |
| `voltagent-lang:sql-pro` | Pure SQL: complex queries, schema design, query plans |

### Verify (test / debug)

| Agent | Use when |
|---|---|
| `agent-skills:test-engineer` | Vitest + RTL test design, coverage gaps (e.g. `src/lib/store/*`) |
| `voltagent-qa-sec:test-automator` | Wiring tests into CI |
| `voltagent-qa-sec:ui-ux-tester` | Browser-driven flows on the live dashboard (has chrome-mcp access) |
| `voltagent-qa-sec:debugger` | Runtime errors, stack traces, repro-then-fix |
| `voltagent-qa-sec:error-detective` | Cross-component error correlation, root-cause analysis |

### Review (pre-merge)

| Agent | Use when |
|---|---|
| `agent-skills:code-reviewer` | Default 5-axis review before merge |
| `pr-review-toolkit:silent-failure-hunter` | Reviewing WS / replay / catch-block code — high payoff here |
| `pr-review-toolkit:type-design-analyzer` | New types in `src/lib/types.ts` or store slices |
| `pr-review-toolkit:pr-test-analyzer` | Verify tests actually cover the new behavior |
| `agent-skills:security-auditor` | WS Origin / payload validation, replay clamp, file-size cap audits |
| `voltagent-qa-sec:performance-engineer` | D3 graph fps, WS message throughput, render hotspots |

### Explore / plan (no code changes)

| Agent | Use when |
|---|---|
| `Explore` | Open-ended search across the codebase (>3 queries) — quick / medium / very thorough |
| `feature-dev:code-explorer` | Trace execution paths (e.g. WS event → store → component) |
| `feature-dev:code-architect` | Implementation blueprint before dispatching builders |
| `Plan` | Multi-step plan with critical-files list and tradeoffs |

### Ship

| Agent | Use when |
|---|---|
| `voltagent-dev-exp:git-workflow-manager` | Branching strategy, rebase plans, history cleanup |
| `voltagent-dev-exp:documentation-engineer` | README / ADR / docs work in `docs/` |

### Default rotation (covers ~90% of changes here)

```
WS / real-time     → voltagent-core-dev:websocket-engineer
UI / components    → voltagent-lang:react-specialist  (or nextjs-developer for routes)
Tests              → agent-skills:test-engineer
Pre-merge review   → agent-skills:code-reviewer + pr-review-toolkit:silent-failure-hunter
Open-ended search  → Explore (medium)
```

### Not relevant for this repo (do not dispatch)

`voltagent-data-ai:ml-engineer` / `machine-learning-engineer` / `ai-engineer` / `nlp-engineer` / `reinforcement-learning-engineer` / `llm-architect` / `data-scientist` / `data-analyst` (no ML), `voltagent-infra:*` (no infra here), mobile/Flutter/Swift/PHP/Go/Rust/Java/.NET/PowerShell language agents, Windows/AD specialists.

## Core Orchestration Rules

- **Brief thoroughly.** Each sub-agent starts with zero context. Use the Delegation Brief Template below.
- **Parallel by default.** If workstreams are independent, dispatch in one message with multiple tool calls.
- **Verify results** against the original assignment and Review Checklist before synthesizing.
- **Synthesize, don't relay.** Integrate findings, resolve conflicts, present one coherent result.
- **Retain ownership.** If a sub-agent's work is wrong, re-dispatch with corrections — do not silently fix it yourself unless it's a trivial import/typo.

## Delegation Brief Template

When dispatching to a sub-agent, always include:

```
Task: [One clear sentence — what to build/fix/review]
Files to create/modify: [Exact paths]
Requirements:
- [Specific requirement with file references]
Constraints:
- Mutations use withAction() wrapper (lib/action-helpers.ts)
- Read-only actions use withReadAction()
- Queries go in lib/db/queries/
- Actions colocate at app/(dashboard)/**/actions.ts
- Components go in components/[feature]/
Expected output: [What the deliverable looks like]
Do not: [What to avoid]
```

## Review Checklist

After every sub-agent returns, verify:

- Follows `withAction()`/`withReadAction()` pattern for server actions (not raw try-catch)
- Queries placed in `lib/db/queries/`, not inline in actions
- No `any` types or unnecessary type assertions
- Imports use `@/` path aliases correctly
- Error handling uses project error hierarchy (`lib/errors.ts`), not generic throws
- Cache invalidation included for mutations that affect cached data
- File placed in correct directory per project structure
- No hardcoded values or magic strings

If review fails: re-assign with specific correction instructions. Fix trivial issues (typos, imports) directly.

## Anti-Patterns to Flag

- Using `fetch()` for internal API calls — use Server Functions
- Raw try-catch in actions — use `withAction()` wrapper
- Business logic in components — extract to `lib/db/queries/` or action layer
- `useEffect` for server data — use Server Components or pass as props
- Inline SQL — use Drizzle query builder
- `console.log` left in code — use project logger (`lib/logger.ts`)
- Components over 200 lines without clear reason — consider splitting
- Missing Zod validation on mutation inputs
- Cache reads without TTL


# Project Overview

This is web portal for Monitor ACtivity for Main-Agent, Sub-Agent and Tools.