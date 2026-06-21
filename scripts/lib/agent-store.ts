import type {
  AgentState,
  EdgeState,
  TeamState,
  WorkflowRunState,
} from "../../src/lib/types";
import { broadcast } from "./sse-broadcast";

// ── HMR-safe singleton state ─────────────────────────
// Stashed on globalThis so Next.js dev hot-reloads do not wipe accumulated
// agent state or the in-flight viewer set.
declare global {
  // eslint-disable-next-line no-var
  var __agentMonitorState:
    | {
        agents: Map<string, AgentState>;
        edges: EdgeState[];
        teams: Map<string, TeamState>;
        workflows: Map<string, WorkflowRunState>;
        agentLastModified: Map<string, number>;
        removedAgentIds: Map<string, number>;
        agentFilePaths: Map<string, string>;
        spawnIndex: Map<string, string>;
        pendingReparents: Map<string, string>;
      }
    | undefined;
}

const store = (globalThis.__agentMonitorState ??= {
  agents: new Map<string, AgentState>(),
  edges: [] as EdgeState[],
  teams: new Map<string, TeamState>(),
  workflows: new Map<string, WorkflowRunState>(),
  agentLastModified: new Map<string, number>(),
  removedAgentIds: new Map<string, number>(),
  agentFilePaths: new Map<string, string>(),
  spawnIndex: new Map<string, string>(),
  pendingReparents: new Map<string, string>(),
});
// A dev process may have created the singleton before newer fields existed;
// hot-reload reuses that object, so backfill anything missing.
store.spawnIndex ??= new Map<string, string>();
store.pendingReparents ??= new Map<string, string>();

export const agents = store.agents;
export const edges = store.edges;
export const teams = store.teams;
export const agentLastModified = store.agentLastModified;
export const removedAgentIds = store.removedAgentIds;
export const agentFilePaths = store.agentFilePaths;
export const workflows = store.workflows;
export const spawnIndex = store.spawnIndex;
export const pendingReparents = store.pendingReparents;

export function upsertWorkflow(run: WorkflowRunState): void {
  workflows.set(run.runId, run);
  broadcast({ type: "workflow:update", workflow: run });
}

export function removeWorkflow(runId: string): void {
  workflows.delete(runId);
  broadcast({ type: "workflow:remove", runId });
}

/** Get the JSONL file path for an agent */
export function getAgentFilePath(agentId: string): string | undefined {
  return agentFilePaths.get(agentId);
}
