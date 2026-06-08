"use client";

import { useAgentStore } from "@/lib/store";
import { UI, STATUS_COLORS } from "@/lib/colors";
import { formatNumber, formatDuration } from "@/lib/utils";
import type { WorkflowAgentRef, WorkflowPhase } from "@/lib/types";

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  running: "#22d3ee",
  completed: "#4ade80",
  failed: "#ef4444",
};

export function WorkflowDetail() {
  const selectedWorkflowId = useAgentStore((s) => s.selectedWorkflowId);
  const workflows = useAgentStore((s) => s.workflows);
  const selectWorkflow = useAgentStore((s) => s.selectWorkflow);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  if (!selectedWorkflowId) return null;
  const run = workflows.get(selectedWorkflowId);
  if (!run) return null;

  const statusColor = WORKFLOW_STATUS_COLORS[run.status] ?? UI.text.muted;

  // Build phase → agents map for progress bars
  const agentsByPhase = new Map<string, WorkflowAgentRef[]>();
  for (const agent of run.agents) {
    const phase = agent.phaseTitle ?? "Unassigned";
    const list = agentsByPhase.get(phase) ?? [];
    list.push(agent);
    agentsByPhase.set(phase, list);
  }

  return (
    <div
      className="fixed bottom-0 right-0 z-50 flex flex-col overflow-hidden rounded-tl-lg"
      style={{
        width: 480,
        maxHeight: "70vh",
        background: "var(--color-panel)",
        border: `1px solid #a855f744`,
        boxShadow: `0 0 30px #a855f722, 0 4px 20px rgba(0,0,0,0.5)`,
        borderRight: "none",
        borderBottom: "none",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: "#a855f7", fontSize: 16 }}>⚙</span>
          <span className="font-mono font-bold text-sm" style={{ color: "#a855f7" }}>
            {run.name}
          </span>
          <span
            className="text-xs capitalize px-1.5 py-0.5 rounded"
            style={{ color: statusColor, background: `${statusColor}22` }}
          >
            {run.status}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close workflow detail"
          onClick={() => selectWorkflow(null)}
          className="text-xs px-2 py-1 rounded"
          style={{ color: UI.text.muted, border: "1px solid var(--color-border)" }}
        >
          Close
        </button>
      </div>

      <div className="overflow-y-auto custom-scrollbar flex-1 p-4 space-y-4">
        {/* Rollups */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-xs" style={{ color: UI.text.dimmed }}>Agents</div>
            <div className="text-lg font-mono font-bold" style={{ color: "#a855f7" }}>{run.agentCount}</div>
          </div>
          {run.durationMs !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Duration</div>
              <div className="text-sm font-mono" style={{ color: UI.text.secondary }}>{formatDuration(run.durationMs)}</div>
            </div>
          )}
          {run.totalTokens !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Tokens</div>
              <div className="text-lg font-mono font-bold" style={{ color: "#a855f7" }}>{formatNumber(run.totalTokens)}</div>
            </div>
          )}
          {run.totalToolCalls !== undefined && (
            <div className="text-center">
              <div className="text-xs" style={{ color: UI.text.dimmed }}>Tool Calls</div>
              <div className="text-sm font-mono" style={{ color: UI.text.secondary }}>{run.totalToolCalls}</div>
            </div>
          )}
        </div>

        {/* Per-phase progress bars */}
        {run.phases.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: UI.text.muted }}>
              Phases
            </div>
            <div className="space-y-2">
              {run.phases.map((phase: WorkflowPhase) => {
                const phaseAgents = agentsByPhase.get(phase.title) ?? [];
                const doneCount = phaseAgents.filter((a) => a.state === "done").length;
                const total = phaseAgents.length;
                const pct = total > 0 ? (doneCount / total) * 100 : 0;

                return (
                  <div key={phase.index}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: UI.text.secondary }}>{phase.title}</span>
                      <span style={{ color: UI.text.muted }}>{doneCount}/{total}</span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: `#a855f722` }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: "#a855f7" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-agent table */}
        {run.agents.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: UI.text.muted }}>
              Agents
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: UI.text.dimmed }}>
                  <th className="text-left pb-1">Label</th>
                  <th className="text-right pb-1">Tokens</th>
                  <th className="text-right pb-1">State</th>
                </tr>
              </thead>
              <tbody>
                {run.agents.map((agent: WorkflowAgentRef) => {
                  const stateColor =
                    agent.state === "done" ? STATUS_COLORS.completed :
                    agent.state === "running" ? STATUS_COLORS.running :
                    agent.state === "error" ? STATUS_COLORS.error :
                    UI.text.muted;

                  return (
                    <tr key={agent.agentId}>
                      <td className="py-0.5">
                        <button
                          type="button"
                          onClick={() => selectAgent(agent.agentId)}
                          className="hover:underline text-left"
                          style={{ color: "#a855f7" }}
                        >
                          {agent.label}
                        </button>
                      </td>
                      <td className="text-right py-0.5" style={{ color: UI.text.secondary }}>
                        {agent.tokens !== undefined ? formatNumber(agent.tokens) : "—"}
                      </td>
                      <td className="text-right py-0.5 capitalize" style={{ color: stateColor }}>
                        {agent.state}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
