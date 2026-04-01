"use client";

import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, AGENT_LABELS, UI, HEATMAP_COLORS } from "@/lib/colors";
import type { AgentType, GraphLayout } from "@/lib/types";
import { HeatmapControls } from "./HeatmapControls";

const FILTER_TYPES = Object.keys(AGENT_COLORS) as AgentType[];

const LAYOUT_OPTIONS: { value: GraphLayout; label: string }[] = [
  { value: "force", label: "FORCE" },
  { value: "tree", label: "TREE" },
  { value: "radial", label: "RADIAL" },
  { value: "hierarchical", label: "HIER" },
];

interface GraphControlsProps {
  onFitToView: () => void;
  onToggleTranscript?: () => void;
  onToggleFileAttention?: () => void;
}

export function GraphControls({ onFitToView, onToggleTranscript, onToggleFileAttention }: GraphControlsProps) {
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);
  const toggleAgentType = useAgentStore((s) => s.toggleAgentType);
  const heatmapEnabled = useAgentStore((s) => s.heatmapEnabled);
  const toggleHeatmap = useAgentStore((s) => s.toggleHeatmap);
  const graphLayout = useAgentStore((s) => s.graphLayout);
  const setGraphLayout = useAgentStore((s) => s.setGraphLayout);

  return (
    <>
    <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
      <div style={{ display: "flex", gap: 4 }}>
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
        <button
          onClick={toggleHeatmap}
          title={heatmapEnabled ? "Disable performance heatmap" : "Enable performance heatmap"}
          aria-label="Toggle performance heatmap"
          aria-pressed={heatmapEnabled}
          className="graph-control-btn"
          style={{
            color: heatmapEnabled ? HEATMAP_COLORS.bottleneck : UI.text.secondary,
            border: `1px solid ${heatmapEnabled ? HEATMAP_COLORS.bottleneck : UI.primary + "44"}`,
            background: heatmapEnabled ? `${HEATMAP_COLORS.bottleneck}22` : "var(--color-panel)",
          }}
        >
          HEAT
        </button>
      </div>
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
      {heatmapEnabled && <HeatmapControls />}
    </div>

    {/* Bottom-left: Layout mode selector */}
    <div
      className="absolute bottom-3 left-3 flex gap-1 z-10"
      style={{ pointerEvents: "auto" }}
    >
      {LAYOUT_OPTIONS.map(({ value, label }) => {
        const active = graphLayout === value;
        return (
          <button
            key={value}
            onClick={() => setGraphLayout(value)}
            title={`Switch to ${label} layout`}
            className="graph-control-btn"
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              color: active ? UI.primary : UI.text.muted,
              background: active ? `${UI.primary}18` : "var(--color-panel)",
              border: `1px solid ${active ? UI.primary : "var(--color-border)"}`,
              borderRadius: 12,
              letterSpacing: "0.5px",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
    </>
  );
}
