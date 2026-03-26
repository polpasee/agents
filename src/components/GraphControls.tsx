"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, AGENT_LABELS, UI } from "@/lib/colors";
import type { AgentType } from "@/lib/types";

const FILTER_TYPES: AgentType[] = [
  "main",
  "explore",
  "plan",
  "build",
  "review",
  "test",
  "team-lead",
  "generic",
];

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
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = UI.primary;
          e.currentTarget.style.color = UI.primary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = `${UI.primary}44`;
          e.currentTarget.style.color = UI.text.secondary;
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
              style={{
                fontFamily: "monospace",
                fontSize: 10,
                fontWeight: 700,
                width: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: hidden ? UI.text.muted : color,
                background: hidden
                  ? "var(--color-panel)"
                  : `${color}18`,
                border: `1px solid ${hidden ? "var(--color-border)" : color}`,
                borderRadius: 4,
                cursor: "pointer",
                opacity: hidden ? 0.5 : 1,
                transition: "all 0.15s ease",
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
