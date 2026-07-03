"use client";

import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { ModalBackdrop } from "./ModalBackdrop";
import { LAYOUT_TUNING_BOUNDS } from "@/lib/config";
import type { LayoutTuning } from "@/lib/types";

interface SliderConfig {
  key: keyof LayoutTuning;
  label: string;
  format?: (value: number) => string;
}

const SLIDERS: SliderConfig[] = [
  { key: "subAgentDistance", label: "Sub-agent distance" },
  { key: "siblingRepulsion", label: "Sibling repulsion" },
  { key: "mainRepulsion", label: "Main repulsion" },
  { key: "fanStrength", label: "Fan strength" },
  {
    key: "fanSpreadDeg",
    label: "Fan spread",
    format: (v) => `${v}°`,
  },
  { key: "mainPeerDistance", label: "Main/peer distance" },
  { key: "chargeReach", label: "Charge reach" },
  { key: "globalRepulsion", label: "Global repulsion" },
  { key: "collisionPadding", label: "Collision padding" },
];

export function LayoutTuningPanel() {
  const showLayoutSettings = useAgentStore((s) => s.showLayoutSettings);
  const toggleLayoutSettings = useAgentStore((s) => s.toggleLayoutSettings);
  const layoutTuning = useAgentStore((s) => s.layoutTuning);
  const setLayoutTuning = useAgentStore((s) => s.setLayoutTuning);
  const resetLayoutTuning = useAgentStore((s) => s.resetLayoutTuning);

  if (!showLayoutSettings) return null;

  return (
    <ModalBackdrop onClose={toggleLayoutSettings}>
      <div
        className="rounded-lg border p-6 w-96"
        style={{
          background: "var(--color-panel)",
          borderColor: `${UI.primary}33`,
          boxShadow: `0 0 30px ${UI.primary}11`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-sm font-bold tracking-widest"
            style={{ color: UI.primary }}
          >
            LAYOUT TUNING
          </h2>
          <button
            onClick={toggleLayoutSettings}
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{
              color: UI.text.muted,
              border: `1px solid var(--color-border)`,
            }}
          >
            ESC
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {SLIDERS.map((s) => {
            const value = layoutTuning[s.key];
            const { min, max, step } = LAYOUT_TUNING_BOUNDS[s.key];
            return (
              <label
                key={s.key}
                className="flex flex-col gap-1 text-xs font-mono"
                style={{ color: UI.text.secondary }}
              >
                <span className="flex items-center justify-between">
                  <span>{s.label}</span>
                  <span style={{ color: UI.text.primary }}>
                    {s.format ? s.format(value) : value}
                  </span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) =>
                    setLayoutTuning({
                      [s.key]: Number(e.target.value),
                    } as Partial<LayoutTuning>)
                  }
                  style={{ accentColor: UI.primary, cursor: "pointer" }}
                />
              </label>
            );
          })}
        </div>

        <button
          onClick={resetLayoutTuning}
          className="mt-4 w-full px-3 py-2 rounded text-sm font-mono"
          style={{
            background: `${UI.primary}08`,
            border: `1px solid ${UI.primary}22`,
            color: UI.primary,
          }}
        >
          Reset to defaults
        </button>
      </div>
    </ModalBackdrop>
  );
}
