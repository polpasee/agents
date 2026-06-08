"use client";

import { useAgentStore } from "@/lib/store";
import { UI, WORKFLOW_COLOR, WORKFLOW_STATUS_COLORS } from "@/lib/colors";
import { formatNumber } from "@/lib/utils";

export function WorkflowPanel() {
  const workflows = useAgentStore((s) => s.workflows);
  const selectedWorkflowId = useAgentStore((s) => s.selectedWorkflowId);
  const selectWorkflow = useAgentStore((s) => s.selectWorkflow);

  if (workflows.size === 0) return null;

  const runList = Array.from(workflows.values());

  return (
    <div
      role="region"
      aria-label="Workflow overview"
      className="flex flex-col"
      style={{
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        className="px-3 py-1.5 text-xs uppercase tracking-wider flex-shrink-0 flex items-center justify-between"
        style={{ color: UI.text.muted, borderBottom: "1px solid var(--color-border)" }}
      >
        <span>Workflows ({runList.length})</span>
      </div>
      <div className="overflow-y-auto custom-scrollbar p-2 space-y-2" style={{ maxHeight: 300 }}>
        {runList.map((run) => {
          const isSelected = run.runId === selectedWorkflowId;
          const statusColor = WORKFLOW_STATUS_COLORS[run.status] ?? UI.text.muted;

          return (
            <button
              key={run.runId}
              type="button"
              className="rounded-md p-2 cursor-pointer transition-colors text-left w-full"
              onClick={() => selectWorkflow(isSelected ? null : run.runId)}
              style={{
                background: isSelected ? `${WORKFLOW_COLOR}11` : "transparent",
                border: `1px solid ${isSelected ? `${WORKFLOW_COLOR}44` : "var(--color-border)"}`,
              }}
            >
              {/* Run header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
                  />
                  <span className="text-sm font-bold font-mono" style={{ color: WORKFLOW_COLOR }}>
                    {run.name}
                  </span>
                </div>
                <span className="text-xs capitalize" style={{ color: statusColor }}>
                  {run.status}
                </span>
              </div>

              {/* Summary */}
              {run.summary && (
                <div className="text-xs mt-1 truncate" style={{ color: UI.text.muted }}>
                  {run.summary}
                </div>
              )}

              {/* Stats row */}
              <div className="flex gap-3 mt-1.5 text-xs">
                <span style={{ color: UI.text.dimmed }}>
                  Agents: <span style={{ color: UI.text.secondary }}>{run.agentCount}</span>
                </span>
                {run.totalTokens !== undefined && (
                  <span style={{ color: UI.text.dimmed }}>
                    Tokens: <span style={{ color: WORKFLOW_COLOR }}>{formatNumber(run.totalTokens)}</span>
                  </span>
                )}
                {run.totalToolCalls !== undefined && (
                  <span style={{ color: UI.text.dimmed }}>
                    Tools: <span style={{ color: UI.text.secondary }}>{run.totalToolCalls}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
