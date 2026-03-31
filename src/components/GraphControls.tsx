"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import type { AgentType } from "@/lib/types";

const FILTER_TYPES = Object.keys(AGENT_COLORS) as AgentType[];

interface GraphControlsProps {
  onFitToView: () => void;
  onToggleTranscript?: () => void;
  onToggleFileAttention?: () => void;
}

export function GraphControls({ onFitToView, onToggleTranscript, onToggleFileAttention }: GraphControlsProps) {
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);
  const toggleAgentType = useAgentStore((s) => s.toggleAgentType);

  return (
    <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
      <button
        onClick={onFitToView}
        title="Fit all agents into view"
        aria-label="Fit all agents into view"
        className="graph-control-btn"
        style={{
          color: UI.text.secondary,
          border: `1px solid ${UI.primary}44`,
        }}
      >
        FIT
      </button>
      {onToggleTranscript && (
        <button
          onClick={onToggleTranscript}
          title="Toggle transcript panel"
          aria-label="Toggle transcript panel"
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: UI.text.secondary,
            background: "var(--color-panel)",
            border: `1px solid ${UI.primary}44`,
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          TXT
        </button>
      )}
      {onToggleFileAttention && (
        <button
          onClick={onToggleFileAttention}
          title="Toggle file attention heatmap"
          aria-label="Toggle file attention heatmap"
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: UI.text.secondary,
            background: "var(--color-panel)",
            border: `1px solid ${UI.primary}44`,
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          FILES
        </button>
      )}
      <div style={{ display: "flex", gap: 2 }}>
        {FILTER_TYPES.map((type) => {
          const hidden = hiddenAgentTypes.has(type);
          const color = AGENT_COLORS[type];
          const label = AGENT_LABELS[type][0]; // first letter
          return (
            <button
              key={type}
              onClick={() => toggleAgentType(type)}
              title={`${hidden ? "Show" : "Hide"} ${AGENT_LABELS[type]} agents`}
              aria-label={`${hidden ? "Show" : "Hide"} ${AGENT_LABELS[type]} agents`}
              aria-pressed={!hidden}
              className="filter-toggle-btn"
              style={{
                color: hidden ? UI.text.muted : color,
                background: hidden
                  ? "var(--color-panel)"
                  : `${color}18`,
                border: `1px solid ${hidden ? "var(--color-border)" : color}`,
                opacity: hidden ? 0.5 : 1,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
