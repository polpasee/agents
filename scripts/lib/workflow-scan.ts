import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowRunState, WorkflowAgentRef, WorkflowPhase, WorkflowStatus } from "../../src/lib/types";

/**
 * Parse a single wf_*.json file into a WorkflowRunState.
 * Returns null on any parse error or missing required fields.
 * Numeric fields in workflowProgress entries are stored as strings in the
 * file format — coerce them via Number().
 */
export function parseWorkflowFile(filePath: string, sessionId: string): WorkflowRunState | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (!data || typeof data !== "object") return null;
    if (typeof data.runId !== "string" || !data.runId) return null;

    const status: WorkflowStatus =
      data.status === "completed" || data.status === "failed"
        ? (data.status as WorkflowStatus)
        : "running";

    const rawPhases = Array.isArray(data.phases) ? data.phases : [];
    const phases: WorkflowPhase[] = rawPhases.map((p: unknown, i: number) => {
      const phase = p as Record<string, unknown>;
      return {
        index: i + 1,
        title: typeof phase.title === "string" ? phase.title : "",
        ...(typeof phase.detail === "string" ? { detail: phase.detail } : {}),
      };
    });

    const rawProgress = Array.isArray(data.workflowProgress) ? data.workflowProgress : [];
    const agents: WorkflowAgentRef[] = rawProgress
      .filter((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        return e.type === "workflow_agent" && typeof e.agentId === "string";
      })
      .map((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        const ref: WorkflowAgentRef = {
          agentId: e.agentId as string,
          label: typeof e.label === "string" ? e.label : (e.agentId as string),
          state: typeof e.state === "string" ? e.state : "unknown",
        };
        if (e.phaseIndex !== undefined) ref.phaseIndex = Number(e.phaseIndex);
        if (e.phaseTitle !== undefined) ref.phaseTitle = String(e.phaseTitle);
        if (e.model !== undefined) ref.model = String(e.model);
        if (e.tokens !== undefined) ref.tokens = Number(e.tokens);
        if (e.toolCalls !== undefined) ref.toolCalls = Number(e.toolCalls);
        if (e.durationMs !== undefined) ref.durationMs = Number(e.durationMs);
        return ref;
      });

    const run: WorkflowRunState = {
      runId: data.runId as string,
      sessionId,
      name: typeof data.workflowName === "string" ? data.workflowName : (data.runId as string),
      status,
      startTime: typeof data.startTime === "number" ? data.startTime : 0,
      agentCount: typeof data.agentCount === "number" ? data.agentCount : agents.length,
      phases,
      agents,
    };

    if (typeof data.durationMs === "number") run.durationMs = data.durationMs;
    if (typeof data.totalTokens === "number") run.totalTokens = data.totalTokens;
    if (typeof data.totalToolCalls === "number") run.totalToolCalls = data.totalToolCalls;
    if (typeof data.summary === "string") run.summary = data.summary;

    return run;
  } catch {
    return null;
  }
}

/**
 * Read <projectPath>/<sessionId>/workflows/wf_*.json and parse each.
 * Drops null results from unparseable files.
 */
export async function scanWorkflows(projectPath: string, sessionId: string): Promise<WorkflowRunState[]> {
  const wfDir = path.join(projectPath, sessionId, "workflows");
  let files: string[];
  try {
    files = await fsp.readdir(wfDir);
  } catch {
    return [];
  }

  const results: WorkflowRunState[] = [];
  for (const file of files) {
    if (!file.startsWith("wf_") || !file.endsWith(".json")) continue;
    const filePath = path.join(wfDir, file);
    const run = parseWorkflowFile(filePath, sessionId);
    if (run !== null) results.push(run);
  }
  return results;
}
