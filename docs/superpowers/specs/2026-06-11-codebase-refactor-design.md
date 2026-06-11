# Whole-Codebase Behavior-Preserving Refactor — Design

Date: 2026-06-11
Status: Approved (autonomous /goal directive: "use a workflow refactor whole codebase")
Driver: Workflow-orchestrated understand phase — 9 parallel read-only scouts (one per
subsystem + one cross-cutting duplication hunter) produced 42 structured candidates
with file:line evidence, risk/effort/value ratings, and test-coverage notes.

## Goal

Reduce duplication, delete grep-confirmed dead code, and clarify module boundaries
across the ~24k-LOC TypeScript codebase **without changing observable behavior**.
Every change must keep the full vitest suite (~787 tests) and `tsc --noEmit` green.

## Non-Goals

- No new features, no API changes, no visual/UI changes.
- No speculative abstractions or configurability (CLAUDE.md: Simplicity First).
- No fixes to latent bugs discovered by scouts (e.g. AgentDetail's `agents.size`
  useMemo dep) — those are behavior-changing and are listed as follow-ups instead.

## Approach (selected from 3)

1. **Selective cleanup via 7 file-disjoint parallel workstreams** — CHOSEN.
   All workstreams run concurrently in one shared worktree, so their file sets are
   strictly disjoint (verified by transitive grouping of candidate file lists).
2. Deep structural redesign (store rearchitecture, module moves) — rejected: no
   driving requirement; high regression risk.
3. One PR per candidate — rejected: ~35 PRs of process overhead for mostly S-effort
   items; per-workstream commits in a single PR give equivalent traceability.

## Workstreams (file-disjoint; one implementer agent each)

### WS-A scanner state/discovery — `scripts/lib/agent-state.ts`, `scripts/lib/discovery.ts`, `scripts/lib/__tests__/{agent-state,start-background-tasks}.test.ts`, `src/instrumentation.ts`, new `scripts/lib/background-tasks.ts`
- Delete dead export `updateTeamStatus` (zero callers repo-wide).
- Extract `registerMainAgent` helper for the duplicated Step-1/Phase-B main-session
  registration in discovery.ts (~16 duplicated lines).
- Extract `isIgnoredSubagentId(id)` for the triplicated `compact-`/`mcp__` predicate.
- Move `startBackgroundTasks`/poll loops verbatim to new `scripts/lib/background-tasks.ts`;
  update `src/instrumentation.ts` and the test's import; reunites `processEntry` with
  `processEntryInner`.
- Drop the ignored `_sessionId` parameter from `processEntry`/`processEntryInner`;
  update discovery.ts call sites and tests; delete the workaround comment.
- Remove the unused `export type { SSEClient }` back-compat re-export
  (agent-state.ts:22) — all consumers import from sse-broadcast directly.

### WS-B scanner infra — `scripts/lib/workflow-scan.ts`, `scripts/lib/file-reader.ts`, `scripts/lib/ccstatusline.ts`, `scripts/lib/config.ts`, `src/app/api/usage/route.ts`
- Delete dead `readEffortLevel`/`readIs1MContext` (+ now-private-only helpers) in
  file-reader.ts — superseded by discovery.ts cached variants (~55 lines).
- Flatten the duplicated parse+push branch arms in `scanWorkflows`.
- Import `CCSTATUSLINE_CACHE` in the usage route instead of its local duplicate;
  fix stale comments referencing the removed ws-server.ts.

### WS-C store — `src/lib/store.ts`, `src/lib/store/*` (slices, helpers, index, eventHandlers) + their tests
- Flatten the `REGISTER_REFRESH` policy table into direct type-safe field merges in
  `applyRegister`.
- Extract the triplicated replay graph-reset partial in replaySlice.
- Unify the five inline localStorage writers behind one `saveLocalStorage` helper.
- Remove dead exports and the duplicated `filter(Boolean) as AgentState[]` cast.
- Delete the 2-line `src/lib/store.ts` re-export shim shadowing `src/lib/store/index.ts`
  (`@/lib/store` resolves identically via directory index under bundler resolution).

### WS-D lib-core + shared helpers — `src/lib/{types,colors,config,validation,utils}.ts`, `src/lib/__tests__/colors.test.ts`, `src/components/{UsagePanel,TopologyUsageStatus,Timeline,TimelineBar,TranscriptPanel}.tsx`
- Remove dead `log:response`/`log:error` ServerEvent variants from the protocol type.
- Delete dead color exports `THEME_COLORS`, `ROLE_COLORS`, `HEATMAP_COLORS` and their
  test references. (LogViewer keeps its local `roleBadgeColor` — adopting the drifted
  dead export would change colors; deletion is the behavior-preserving direction.
  The matching dead *import* in `src/lib/d3/heatmap.ts` is removed by WS-F.)
- Remove dead `IDLE_TIMEOUT_MS` (with its misleading comment) and dead `ReportData` type.
- Single-source `AgentStatus`/`AgentType` literals from const arrays following the
  existing `THINKING_EFFORTS` pattern (types.ts + validation.ts).
- Name the `#00ff88` success-green once in colors.ts (matches `--color-green` in
  globals.css); replace the literals in TimelineBar/TranscriptPanel.
- Move byte-identical `getBarColor` to colors.ts; unify drifted `formatResetTime`
  into utils.ts using the UsagePanel format (TopologyUsageStatus's own doc comment
  says it "mirrors the bars in UsagePanel"; its reset text gains spaces/`hr` —
  accepted as a documented drift fix, the only text delta in this refactor).
- Extract `earliestStartTime(agents, fallback)` into utils.ts for the duplicated
  stack-safe fold (+ duplicated comment) in Timeline/TimelineBar.

### WS-E components — `src/components/{AgentList,CostProjection,AgentDetail,TeamPanel,SessionComparison}.tsx` + their tests
- AgentList: extract the verbatim 15-line session-grouping helper.
- CostProjection: compute the alert-level color once instead of three nested ternaries.
- AgentDetail: consolidate the three duplicated failure paths in `handleViewLog`
  behind a local `fail()` helper (keep the success path's existing semantics).
- TeamPanel: render the expanded member list as a sibling of the card button
  (fixes invalid nested `<button>` DOM; same interactions; drops stopPropagation hacks).
- SessionComparison: collapse MetricRow's always-identical valueColor/deltaColor
  props into one `color` prop computed once per row; drop the redundant
  `(n) => formatCost(n)` lambda.

### WS-F d3/graph — `src/components/AgentGraph/*`, `src/lib/d3/{index,renderNode,layouts,heatmap}.ts`, `src/lib/__tests__/d3-layouts*.test.ts`
- Extract shared cluster-hull geometry helpers from the team/workflow copy-paste
  pair in useTopologyEffect's tick handler (the one M-effort item; 551-line file).
- Delete dead `wrapToolText` export.
- Extract the shared simulation drag behavior used by agent nodes and tool nodes.
- Drop the never-used `edges` parameter threaded through all layout functions
  (+ update the two layout test files).
- Remove dead imports (incl. the dead `HEATMAP_COLORS` import in heatmap.ts whose
  export WS-D deletes) and the void-UI keep-alive hack in useNodeVisualsEffect.
- Hoist the duplicated link-path `d` callbacks (glow vs main).

### WS-G hooks/app — `src/hooks/{useApiUsage,useEventStream,useKeyboardShortcuts}.ts`, `src/app/api/stream/route.ts`
- Remove dead `plan` field from the ApiUsage client interface (server never sends it).
- Normalize type imports to the `@/lib/types` alias (drop inline `import("@/lib/types")`
  forms and the one deep relative path).
- useKeyboardShortcuts: read store via `getState()` inside the keydown handler
  instead of five subscriptions (matches sibling hooks; stops listener
  re-registration on every store mutation; tests remain valid unchanged).

## Explicitly Excluded (decision recorded, no change made)

| Candidate | Reason |
| --- | --- |
| Align AgentDetail/DiffViewer/ActivityStream on `agentColor()` | Visible color change — not behavior-preserving; owner call. |
| Remove TimelineBar inert review-mode speed controls | Removes visible UI; scout flagged "confirm not a planned feature." |
| Remove (or wire) the never-fired webhook pipeline | Product decision, deletes a whole module + tests. |
| Single-source cross-boundary protocol defaults | Spans WS-A and WS-D files (concurrency conflict); scout rated value low. |
| LogViewer adopt `ROLE_COLORS` | Superseded: export is dead AND drifted; deleting it preserves behavior. |

Follow-ups surfaced by scouts, out of scope (latent bugs / behavior-changing):
AgentDetail `agents.size` useMemo staleness; `/api/costs` + `/api/usage` missing
origin guard; missing tests for LogViewer/CostProjection/ActivityStream/
FileAttentionPanel/TimelineBar/UsagePanel/TopologyUsageStatus.

## Verification

1. Each implementer runs the test files adjacent to its workstream during work.
2. Gate (Step 4): full `npx vitest run` + `npx tsc --noEmit` in the worktree —
   must be 100% green; transient cross-WS coupling (HEATMAP_COLORS export/import)
   resolves only at the gate, by design.
3. Step 5: two-opinion review (first: /codex:review, fallback
   /pr-review-toolkit:review-pr; second: /code-review max). Fix → re-gate → re-review
   until both opinions are clean.
4. Step 6: single PR from `worktree-workflow-codebase-refactor`, per-workstream
   commits, merge, delete branch + worktree.

## Post-Review Amendments (2026-06-12)

Two-opinion review (first: pr-review-toolkit 5-agent panel; second: /code-review
max — 9 finder angles, per-candidate verification, gap sweep; 29 confirmed
findings, none functional) corrected this spec and drove a fix pass:

**Accepted deltas (the spec previously claimed only one):**
1. TopologyUsageStatus reset-text format (as originally documented).
2. TeamPanel click surface: the nested-`<button>` fix means clicks on the card
   padding and expanded member-list whitespace/labels no longer toggle the team
   (on main they bubbled to the card button — accidental fallout of the invalid
   DOM). "Same interactions" in WS-E above was an overclaim; the header button
   and member buttons behave identically, and the lost surface is accepted.
3. localStorage error policy: unifying the five writers normalized failure
   handling to warn-and-continue. Previously one site swallowed silently by
   recorded decision and four threw before the state update; the unified
   policy (in-memory update proceeds, console.warn emitted) is accepted as the
   better default and documented in the helper.

**Review-driven cleanups applied:** TeamPanel adopts getTeamStats/teamMembers/
truncateId; CostProjection/UsagePanel/TopologyUsageStatus adopt the shared
fold/reset helpers; hull geometry moved to src/lib/d3/clusterHull.ts; shared
fx-aware linkPath; UI.success adopted at the two remaining byte-identical
sites; getBarColor thresholds hoisted to config; PROJECTS_DIR and
CCSTATUSLINE_CACHE single-sourced in scripts/lib/config.ts; registerMainAgent
takes an options object; background-tasks owns its start-once flag; discovery
meta lookup uses a Set.

**Deliberately not done (recorded):** generalizing the min-fold shared by
clusterLabelAnchor/earliestStartTime (speculative abstraction over unlike
shapes); hoisting the pre-existing per-tick d3 data-join/static-attr work out
of the topology tick handler (delicate restructure of pre-existing cost —
follow-up); HEATMAP.colors keeps its literal green (independent scale
endpoint, not UI "success" semantics).

## Risks

- Concurrent agents share one worktree → workstream file sets are strictly disjoint;
  agents are forbidden to touch files outside their list and do not run `git commit`.
- The store-shim deletion relies on bundler directory-index resolution — covered by
  the entire suite importing `@/lib/store`.
- WS-D's formatResetTime unification changes overlay reset text formatting — the
  single accepted, documented delta (drift fix endorsed by the component's own docs).
