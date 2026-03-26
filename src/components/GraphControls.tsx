"use client";

import { UI } from "@/lib/colors";

interface GraphControlsProps {
  onFitToView: () => void;
}

export function GraphControls({ onFitToView }: GraphControlsProps) {
  return (
    <div className="absolute top-2 right-2 flex gap-1 z-10">
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
    </div>
  );
}
