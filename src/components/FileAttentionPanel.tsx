"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";

interface FileEntry {
  path: string;
  reads: number;
  edits: number;
  total: number;
}

export function FileAttentionPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const agents = useAgentStore((s) => s.agents);

  const files = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const agent of agents.values()) {
      for (const tc of agent.toolCalls) {
        // Extract file path from tool call args
        const pathMatch = tc.args?.match(/file_path:\s*([^\s,]+)/);
        const patternMatch = tc.args?.match(/pattern:\s*([^\s,]+)/);
        const filePath = pathMatch?.[1] || patternMatch?.[1];
        if (!filePath) continue;

        const entry = map.get(filePath) || {
          path: filePath,
          reads: 0,
          edits: 0,
          total: 0,
        };
        if (tc.tool === "Read" || tc.tool === "Grep" || tc.tool === "Glob") {
          entry.reads++;
        } else if (tc.tool === "Edit" || tc.tool === "Write") {
          entry.edits++;
        }
        entry.total = entry.reads + entry.edits;
        map.set(filePath, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [agents]);

  if (!open) return null;

  const maxTotal = files[0]?.total || 1;

  function heatColor(ratio: number): string {
    if (ratio > 0.7) return UI.error;
    if (ratio > 0.4) return UI.tool;
    return UI.primary;
  }

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden"
      style={{
        width: 320,
        background: "var(--color-panel)",
        borderLeft: "1px solid var(--color-border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span
          className="text-xs uppercase tracking-wider font-mono"
          style={{ color: UI.text.muted }}
        >
          File Attention
        </span>
        <button
          onClick={onClose}
          className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{
            color: UI.text.muted,
            border: "1px solid var(--color-border)",
          }}
          aria-label="Close file attention panel"
        >
          x
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {files.length === 0 && (
          <div
            className="text-xs text-center py-8"
            style={{ color: UI.text.empty }}
          >
            No file activity yet
          </div>
        )}
        {files.map((file) => {
          const ratio = file.total / maxTotal;
          const color = heatColor(ratio);
          const shortPath = file.path.split("/").slice(-2).join("/");
          return (
            <div
              key={file.path}
              className="rounded px-2 py-1.5"
              style={{
                background: `${color}08`,
                border: `1px solid ${color}15`,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-mono truncate"
                  style={{ color, maxWidth: 200 }}
                  title={file.path}
                >
                  {shortPath}
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: UI.text.dimmed }}
                >
                  {file.total}
                </span>
              </div>
              {/* Heat bar */}
              <div
                className="mt-1 h-1 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${ratio * 100}%`,
                    background: color,
                    opacity: 0.7,
                  }}
                />
              </div>
              <div
                className="flex gap-2 mt-0.5 text-xs"
                style={{ color: UI.text.dimmed }}
              >
                {file.reads > 0 && <span>{file.reads} reads</span>}
                {file.edits > 0 && <span>{file.edits} edits</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {files.length > 0 && (
        <div
          className="px-3 py-1.5 text-xs font-mono"
          style={{
            color: UI.text.dimmed,
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {files.length} files tracked
        </div>
      )}
    </div>
  );
}
