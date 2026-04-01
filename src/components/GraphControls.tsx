"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import type { GraphLayout } from "@/lib/types";

const LAYOUT_OPTIONS: { value: GraphLayout; label: string }[] = [
  { value: "force", label: "FORCE" },
  { value: "tree", label: "TREE" },
  { value: "radial", label: "RADIAL" },
  { value: "hierarchical", label: "HIER" },
];

export function GraphControls() {
  const graphLayout = useAgentStore((s) => s.graphLayout);
  const setGraphLayout = useAgentStore((s) => s.setGraphLayout);

  return (
    <>
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
