"use client";

import { useAgentStore } from "@/lib/store";
import { UI, STATUS_COLORS, AGENT_COLORS, AGENT_LABELS } from "@/lib/colors";
import { ModalBackdrop } from "./ModalBackdrop";

export function ErrorDrillDown() {
  const errorDrillDownAgentId = useAgentStore((s) => s.errorDrillDownAgentId);
  const closeErrorDrillDown = useAgentStore((s) => s.closeErrorDrillDown);
  const openErrorDrillDown = useAgentStore((s) => s.openErrorDrillDown);
  const agents = useAgentStore((s) => s.agents);
  const errorDetails = useAgentStore((s) => s.errorDetails);

  if (!errorDrillDownAgentId) return null;

  const agent = agents.get(errorDrillDownAgentId);
  const detail = errorDetails.get(errorDrillDownAgentId);

  if (!agent) return null;

  const errorColor = STATUS_COLORS.error;
  const agentColor = AGENT_COLORS[agent.agentType];
  const recentTools = agent.toolCalls.slice(-5).reverse();
  const errorMessage = detail?.message ?? "Unknown error";
  const errorTimestamp = detail?.timestamp ?? agent.startTime;
  const cascadeIds = detail?.cascadeIds ?? [];

  return (
    <ModalBackdrop onClose={closeErrorDrillDown}>
      <div
        className="flex flex-col max-h-[80vh] w-[480px] rounded-lg overflow-hidden"
        style={{
          background: "var(--color-panel)",
          border: `1px solid ${errorColor}44`,
          boxShadow: `0 0 30px ${errorColor}22, 0 4px 20px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: `${errorColor}11`,
            borderBottom: `1px solid ${errorColor}33`,
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: errorColor, boxShadow: `0 0 8px ${errorColor}` }}
            />
            <span className="text-sm font-bold uppercase tracking-wider" style={{ color: errorColor }}>
              Error Details
            </span>
          </div>
          <button
            onClick={closeErrorDrillDown}
            className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity cursor-pointer"
            style={{
              color: UI.text.muted,
              background: "var(--color-border)",
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* Agent Info */}
          <div>
            <SectionLabel>AGENT</SectionLabel>
            <div className="flex items-center gap-2 mt-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: agentColor, boxShadow: `0 0 6px ${agentColor}` }}
              />
              <span className="text-sm font-bold" style={{ color: agentColor }}>
                {AGENT_LABELS[agent.agentType]}
              </span>
            </div>
            <div className="text-xs mt-0.5 truncate" style={{ color: UI.text.dimmed }}>
              {agent.id}
            </div>
          </div>

          {/* Task */}
          <div>
            <SectionLabel>TASK</SectionLabel>
            <span className="text-sm" style={{ color: UI.text.primary }}>
              {agent.task}
            </span>
          </div>

          {/* Error Message */}
          <div>
            <SectionLabel>ERROR</SectionLabel>
            <div
              className="text-sm rounded px-3 py-2 mt-1 font-mono whitespace-pre-wrap break-words"
              style={{
                color: errorColor,
                background: `${errorColor}11`,
                border: `1px solid ${errorColor}22`,
              }}
            >
              {errorMessage}
            </div>
          </div>

          {/* Timestamp */}
          <div>
            <SectionLabel>TIMESTAMP</SectionLabel>
            <span className="text-sm" style={{ color: UI.text.secondary }}>
              {new Date(errorTimestamp).toLocaleString()}
            </span>
          </div>

          {/* Error Cascade */}
          {cascadeIds.length > 0 && (
            <div>
              <SectionLabel>ERROR CASCADE</SectionLabel>
              <div className="space-y-1 mt-1">
                {cascadeIds.map((id) => {
                  const cascadeAgent = agents.get(id);
                  if (!cascadeAgent) return null;
                  const cColor = AGENT_COLORS[cascadeAgent.agentType];
                  return (
                    <button
                      key={id}
                      onClick={() => openErrorDrillDown(id)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        background: `${errorColor}0a`,
                        border: `1px solid ${errorColor}22`,
                      }}
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: cColor, boxShadow: `0 0 4px ${cColor}` }}
                      />
                      <span className="text-xs font-bold" style={{ color: cColor }}>
                        {AGENT_LABELS[cascadeAgent.agentType]}
                      </span>
                      <span className="text-xs truncate flex-1" style={{ color: UI.text.dimmed }}>
                        {id}
                      </span>
                      <span className="text-xs" style={{ color: errorColor }}>
                        error
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Tool Calls */}
          <div>
            <SectionLabel>LAST TOOL CALLS BEFORE ERROR</SectionLabel>
            <div className="space-y-1 mt-1">
              {recentTools.length === 0 ? (
                <span className="text-xs" style={{ color: UI.text.empty }}>
                  No tool calls recorded
                </span>
              ) : (
                recentTools.map((tc, i) => (
                  <div
                    key={`${tc.tool}-${tc.timestamp}`}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "var(--color-border)", color: UI.tool }}
                  >
                    {tc.tool}
                    {tc.args && (
                      <span style={{ color: UI.text.dimmed }}> — {tc.args}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-xs uppercase tracking-wider mb-0.5"
      style={{ color: UI.text.dimmed }}
    >
      {children}
    </div>
  );
}
