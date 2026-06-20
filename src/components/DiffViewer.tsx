"use client";

import { useEffect, useCallback } from "react";
import { useAgentStore } from "@/lib/store";
import { UI, AGENT_COLORS, AGENT_LABELS, CHANGE_COLORS } from "@/lib/colors";
import { ModalBackdrop } from "./ModalBackdrop";

const CHANGE_LABELS: Record<string, string> = {
  create: "A",
  edit: "M",
  delete: "D",
};

export function DiffViewer() {
  const diffViewerAgentId = useAgentStore((s) => s.diffViewerAgentId);
  const agentDiffs = useAgentStore((s) => s.agentDiffs);
  const agents = useAgentStore((s) => s.agents);
  const closeDiffViewer = useAgentStore((s) => s.closeDiffViewer);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDiffViewer();
    },
    [closeDiffViewer],
  );

  useEffect(() => {
    if (!diffViewerAgentId) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diffViewerAgentId, handleKeyDown]);

  if (!diffViewerAgentId) return null;

  const diffs = agentDiffs.get(diffViewerAgentId) ?? [];
  const agent = agents.get(diffViewerAgentId);
  const color = agent ? AGENT_COLORS[agent.agentType] : UI.primary;
  const label = agent ? AGENT_LABELS[agent.agentType] : "AGENT";

  const totalFiles = diffs.length;
  const creates = diffs.filter((d) => d.operation === "create").length;
  const edits = diffs.filter((d) => d.operation === "edit").length;
  const deletes = diffs.filter((d) => d.operation === "delete").length;

  return (
    <ModalBackdrop onClose={closeDiffViewer}>
      <div
        className="flex flex-col rounded-lg overflow-hidden"
        style={{
          width: 600,
          maxHeight: "80vh",
          background: "var(--color-panel)",
          border: `1px solid ${color}44`,
          boxShadow: `0 0 30px ${color}22`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${color}33` }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: color, boxShadow: `0 0 6px ${color}` }}
            />
            <span className="text-sm font-bold" style={{ color }}>
              {label}
            </span>
            <span className="text-xs" style={{ color: UI.text.dimmed }}>
              File Changes
            </span>
          </div>
          <button
            onClick={closeDiffViewer}
            className="text-xs px-2 py-1 rounded hover:opacity-80"
            style={{ color: UI.text.muted, background: "var(--color-border)" }}
          >
            ESC
          </button>
        </div>

        {/* Summary Bar */}
        <div
          className="flex items-center gap-4 px-4 py-2 text-xs"
          style={{
            background: "var(--color-border)",
            color: UI.text.secondary,
          }}
        >
          <span>
            <span style={{ color: UI.text.primary }}>{totalFiles}</span> file
            {totalFiles !== 1 ? "s" : ""}
          </span>
          <span style={{ color: CHANGE_COLORS.create }}>+{creates} added</span>
          <span style={{ color: CHANGE_COLORS.edit }}>~{edits} modified</span>
          <span style={{ color: CHANGE_COLORS.delete }}>
            -{deletes} deleted
          </span>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {diffs.length === 0 ? (
            <div
              className="text-center py-8 text-sm"
              style={{ color: UI.text.empty }}
            >
              No file changes recorded
            </div>
          ) : (
            diffs.map((diff, i) => (
              <div
                key={`${diff.filePath}-${i}`}
                className="flex items-center gap-2 px-3 py-2 rounded"
                style={{ background: "var(--color-bg)" }}
              >
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono uppercase"
                  style={{
                    color: CHANGE_COLORS[diff.operation],
                    background: `${CHANGE_COLORS[diff.operation]}18`,
                    border: `1px solid ${CHANGE_COLORS[diff.operation]}33`,
                    minWidth: 28,
                    textAlign: "center",
                  }}
                >
                  {CHANGE_LABELS[diff.operation]}
                </span>
                <span
                  className="flex-1 text-xs font-mono truncate"
                  style={{ color: UI.text.primary }}
                >
                  {diff.filePath}
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: UI.text.dimmed }}
                >
                  {diff.operation}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
