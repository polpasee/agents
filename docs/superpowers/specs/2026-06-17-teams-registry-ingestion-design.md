# Teams-Registry Ingestion — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming)

## Problem

Teammates spawned via the `Agent` tool (the "← for agents" / teams feature) never
appear in the Agent Monitor topology. Only the main session node renders.

Root cause (verified on disk + in code): the monitor's discovery
(`scripts/lib/discovery.ts::discoverActiveSessions`) reads agents **only** from
`~/.claude/projects/<projectDir>/<sessionId>/subagents/`. Teammates are recorded
by the harness in a completely separate registry that the monitor never reads:

- `~/.claude/teams/session-<id>/config.json` — `members[]` (lead + teammates)
- `~/.claude/teams/session-<id>/inboxes/<member>.json` — per-member mailboxes
- `~/.claude/jobs/<id>/timeline.jsonl`

No `subagents/` directory is ever created for a teammate, so it is invisible by
construction.

## Goal

Render each teammate as a child of its lead/main session node in the topology,
reusing the existing `AgentState` / `TeamState` / edge model. Parent-child only.

## Non-goals (deferred)

- Teammate↔teammate peer/message edges (the render layer already supports
  `edgeType: "message"`, but the only data source — inbox messages — empties as
  messages are consumed, so peer links would be transient). Follow-up.
- Teammate completion/"done" detection, mailbox message rendering, tmux state.

## Design

### New module: `scripts/lib/teams-discovery.ts`

Export `discoverTeams(teamsDir: string): Promise<void>`. Called from
`background-tasks.ts::pollLoop` on **every** tick, after the discovery/refresh
branch. Cheap (a handful of small JSON files).

Per `~/.claude/teams/session-*/config.json`:

1. Read+parse `config.json`. Skip on any read/parse error (defensive — never
   throw out of the poll loop).
2. Resolve `leadSessionId`. **If `agents.has(leadSessionId)` is false, skip the
   whole team** — teammates attach only under an already-registered main, which
   avoids orphan/duplicate lead nodes. Inherit `projectDir` from
   `agents.get(leadSessionId).metadata.projectDir`.
3. For each `member` where `member.agentId !== config.leadAgentId` (skip the
   lead — it IS the main node):
   - If `!agents.has(member.agentId)`: clear `removedAgentIds`, then
     `registerAgent({ agentId: member.agentId, sessionId: leadSessionId,
     projectDir, parentId: leadSessionId, agentType: parseAgentType(member.agentType),
     displayType: member.agentType, task: member.name, slug: member.name,
     model: member.model ?? "", startTime: member.joinedAt,
     teamId: config.name, teamName: config.name })`.
   - Always `updateAgentStatus(member.agentId, activityMtime)` where
     `activityMtime = max(config.json mtime, member inbox file mtime, joinedAt)`.

### Wiring: `config.ts`

Add `export const TEAMS_DIR = path.join(os.homedir(), ".claude", "teams");`

### Wiring: `background-tasks.ts`

Import `discoverTeams` + `TEAMS_DIR`; call `await discoverTeams(TEAMS_DIR)` inside
`pollLoop` (after the full-scan/refresh branch, inside the same `try`).

### Liveness / pruning

Teammates carry a `parentId`, so the existing `SUBAGENT_STALE_THRESHOLD_MS`
(60s) purge applies unchanged. `discoverTeams` refreshes status from the team
`config.json` mtime each tick, so an active team's members stay live; a member
removed from `members[]` stops being refreshed and auto-purges after 60s. No
special-case lifecycle code.

## Components & boundaries

- `teams-discovery.ts` — one job: read the teams registry, register/refresh
  teammate AgentStates. Depends on `agent-state.ts` (registerAgent,
  updateAgentStatus, agents, removedAgentIds), `parseAgentType`, `config.ts`.
  No DOM, no SSE knowledge (registerAgent/updateAgentStatus broadcast).
- No changes to `discovery.ts`, the SSE layer, the store, or the topology
  renderer — they already handle child agents and the `TeamState` model.

## Testing (TDD)

`scripts/lib/__tests__/teams-discovery.test.ts`, against fixture teams dirs in a
tmp path:

1. Member → registered as child of `leadSessionId` (parentId + edge present).
2. Lead member (`agentId === leadAgentId`) is NOT registered (no duplicate).
3. Team whose `leadSessionId` is not a registered main → all members skipped.
4. Teammate inherits the lead main's `projectDir` (repo scoping).
5. `agentType`/`displayType`/`model`/`slug`/`startTime` mapped from member.
6. Idempotent: second `discoverTeams` does not duplicate edges/members; status
   refreshed via `updateAgentStatus`.
7. Malformed/missing `config.json` → no throw, other teams still processed.
8. Member removed from a later config snapshot → not re-registered (purge left
   to existing stale logic; assert discoverTeams itself does not re-add it).

Full existing suite must stay green.
