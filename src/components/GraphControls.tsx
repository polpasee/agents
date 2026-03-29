"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import type { AgentType } from "@/lib/types";

const FILTER_TYPES = Object.keys(AGENT_COLORS) as AgentType[];

interface GraphControlsProps {
  onFitToView: () => void;
}

export function GraphControls({ onFitToView }: GraphControlsProps) {
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
