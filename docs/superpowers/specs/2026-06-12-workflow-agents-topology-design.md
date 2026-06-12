# Workflow-Spawned Agents in Graph Topology — Design

**Date:** 2026-06-12
**Status:** Approved (user: "fix it"; autonomous session, steps run without per-step approval per CLAUDE.md)

## Problem

Sessions that use the Claude Code **Workflow** tool spawn many subagents, but none of them
appear in the graph topology. Root cause (confirmed by 2 adversarial verifiers against code
and on-disk data):

- Workflow subagent transcripts are written to
  `<session>/subagents/workflows/<runId>/agent-*.jsonl` — one level deeper than the flat
  `<session>/subagents/agent-*.jsonl` layout used by Task/Agent-spawned subagents.
- Discovery Step 2 (`scripts/lib/discovery.ts:428-433`) does a single non-recursive
  `readdir` of `subagents/` and filters to names ending in `.jsonl`, so the `workflows`
  directory entry is discarded. `registerAgent` has exactly two call sites (discovery.ts:100
  for mains, :601 for this loop); there is no other intake path. The agents never become
  nodes.

Confirmed-but-downstream facts (no code change needed for this fix):

- Workflow metas are exactly `{"agentType":"workflow-subagent"}` — no `toolUseId`. The
  existing fallback (`parentId = sessionId`, discovery.ts:589) anchors such agents to the
  session root, which is correct here: the Workflow tool is invoked by the main agent.
- The spawn index only records `Agent`/`Task` tool_use blocks (agent-state.ts:122). The
  parent transcript's `Workflow` tool_use contains no child agentIds, so spawn-index
  parenting is impossible by design; the session-root anchor is the right shape.
- The workflow panel pipeline (`workflow-scan.ts` → `workflows` Map → `workflow:update`)
  is panel/hull-only and never registers agents. The hull overlay
  (`useTopologyEffect.ts:233-259`) joins `run.agents[].agentId` against live sim nodes —
  on-disk agentIds in `wf_*.json` match the nested transcript filenames exactly, so the
  hull grouping lights up automatically once the agents register.

## Goal

Minimal change: workflow subagents register during discovery and render in the topology,
anchored to their session node, with the existing per-run hull grouping working unchanged.

## Approaches Considered

1. **Targeted descent (chosen).** In Step 2, after the flat listing, additionally list
   `subagents/workflows/` and, for each run directory inside it, list its
   `agent-*.jsonl` / `agent-*.meta.json` files. Feed them through the existing
   Phase A / Phase B pipeline. Explicit, zero behavior change for flat files.
2. **Fully recursive walk of `subagents/`.** Rejected: silently ingests unknown future
   layouts and reintroduces the stat-heavy scanning the Step 2 comment warns about.
3. **Drive discovery from `wf_*.json` / `journal.jsonl`.** Rejected: `wf_*.json` does not
   exist while a run is in flight (verified on disk), so live runs — the app's core use
   case — would still be missing; adds a new parser surface.

## Design

All changes in `scripts/lib/discovery.ts`, Step 2 of `discoverActiveSessions`.

### Enumeration

- After the flat `readdir(subagentsDir)`, if the listing contains `workflows`, read
  `subagentsDir/workflows` with `withFileTypes`. For each **directory** entry (run dir),
  `readdir` it and collect its files.
- Candidate files become `{ dir, name }` pairs (flat files: `dir = subagentsDir`; nested:
  `dir = subagentsDir/workflows/<runDir>`). The `agent-(.+)\.jsonl` id match and
  `isIgnoredSubagentId` gate apply to `name` exactly as today.
- `journal.jsonl` and any non-`agent-*` files in run dirs fail the id match and are
  buffered without registration — same handling as today's non-agent flat files (their
  mtime still backfills/freshens the parent session, which is desirable: a live workflow
  keeps its session marked alive).
- Meta lookup becomes per-directory: Phase B resolves `agent-<id>.meta.json` against the
  same `dir` as the transcript (today it joins against `subagentsDir`; the set of meta
  names becomes a set of full paths or per-dir sets — implementer's choice, smallest diff
  wins).
- Read failures on `workflows/` or a run dir are skipped silently, matching the existing
  per-directory `try/catch → continue` idiom.

### Registration (unchanged behavior, by construction)

- `parseAgentType("workflow-subagent")` → `"generic"`; `displayType` carries the raw
  string for the UI. No type-taxonomy changes.
- No `toolUseId` in meta → existing `parentId = sessionId` fallback, no `pendingReparents`
  entry. Dependency sort and spawn-depth logic see these agents as depth 0.
- `agentFilePaths` stores the full nested path, so `refreshTrackedAgents`, offset
  tracking (`readNewLines`), tombstones, and `pruneState` work unchanged.

### Frontend

No changes. Nodes arrive via the normal `agent:register` / `state:sync` path; the hull
overlay join starts matching as soon as `wf_*.json` exists for the run.

## Testing

Extend `scripts/lib/__tests__/discovery.test.ts` (mocked-fs helpers around line 605):

1. Nested workflow agent (`subagents/workflows/wf_x/agent-a1.jsonl` + meta
   `{"agentType":"workflow-subagent"}`) is registered with `parentId = sessionId`,
   `agentType = "generic"`, `displayType = "workflow-subagent"`.
2. Flat and nested agents in the same session both register (no regression).
3. `journal.jsonl` inside a run dir is not registered as an agent.
4. Ignored ids (`compact-*`) inside run dirs stay ignored.
5. A file directly inside `subagents/workflows/` (not in a run dir) is not picked up
   (defines the boundary of the descent).

Gates: full `vitest` suite + `tsc --noEmit` clean.

## Explicitly Excluded (follow-ups, not this change)

- A `journal.jsonl` reader for richer live run state (labels, phases) before `wf_*.json`
  lands. Nodes appear live regardless via transcripts; only hull grouping waits.
- Spawn-index awareness of the `Workflow` tool name (no agentIds exist in the parent
  transcript to link, so there is nothing to index).
- Worktree dir-split handling (a worktree session's artifacts span two munged project
  dirs; pre-existing, orthogonal).
- Node labels from `wf_*.json` `workflowProgress` labels (e.g. `skeptic:ui-store`) —
  would couple discovery to the panel pipeline; revisit if generic labels prove confusing.
