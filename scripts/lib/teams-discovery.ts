// ── Teams-registry ingestion ──────────────────────────
// Reads ~/.claude/teams/session-*/config.json on every poll tick and
// registers each non-lead team member as a child of its lead/main session
// node. Safe to call frequently — it only touches small JSON files and
// skips teams whose lead is not yet registered.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  agents,
  removedAgentIds,
  registerAgent,
  updateAgentStatus,
  parseAgentType,
} from "./agent-state";

interface TeamMember {
  agentId: string;
  name: string;
  agentType: string;
  joinedAt: number;
  model?: string;
  cwd?: string;
  prompt?: string;
}

interface TeamConfig {
  name: string;
  leadAgentId: string;
  leadSessionId: string;
  members: TeamMember[];
}

/**
 * Discover teammate agents from the teams registry and register/refresh them
 * in the shared agent state. Called on every poll tick from background-tasks.
 *
 * Guarantees: never throws. Each bad entry is skipped; sibling teams still
 * process normally.
 */
export async function discoverTeams(teamsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(teamsDir);
  } catch {
    // teamsDir doesn't exist or can't be read — not an error
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith("session-")) continue;

    const sessionPath = path.join(teamsDir, entry);
    const configPath = path.join(sessionPath, "config.json");

    let config: TeamConfig;
    let configMtimeMs: number;

    try {
      const [raw, stat] = await Promise.all([
        fsp.readFile(configPath, "utf-8"),
        fsp.stat(configPath),
      ]);
      config = JSON.parse(raw) as TeamConfig;
      configMtimeMs = stat.mtimeMs;
    } catch {
      // Missing or malformed config.json — skip this team
      continue;
    }

    const { name: teamName, leadAgentId, leadSessionId, members } = config;

    // Only attach teammates under an already-registered main session.
    // If the lead isn't known yet, skip the whole team — avoids orphan nodes.
    if (!agents.has(leadSessionId)) continue;

    const projectDir = agents.get(leadSessionId)?.metadata?.projectDir as string | undefined;
    if (!projectDir) continue;

    for (const member of members) {
      // Skip the lead — it is already the main session node
      if (member.agentId === leadAgentId) continue;

      // Compute activity mtime: max(configJson mtime, inbox file mtime, joinedAt)
      let activityMtime = Math.max(configMtimeMs, member.joinedAt);
      try {
        const inboxPath = path.join(sessionPath, "inboxes", `${member.name}.json`);
        const inboxStat = await fsp.stat(inboxPath);
        activityMtime = Math.max(activityMtime, inboxStat.mtimeMs);
      } catch {
        // Inbox file absent or unreadable — use config mtime
      }

      if (!agents.has(member.agentId)) {
        removedAgentIds.delete(member.agentId);
        registerAgent({
          agentId: member.agentId,
          sessionId: leadSessionId,
          projectDir,
          parentId: leadSessionId,
          agentType: parseAgentType(member.agentType),
          displayType: member.agentType,
          task: member.name,
          slug: member.name,
          model: member.model ?? "",
          startTime: member.joinedAt,
          teamId: teamName,
          teamName,
        });
      }

      updateAgentStatus(member.agentId, activityMtime);
    }
  }
}
