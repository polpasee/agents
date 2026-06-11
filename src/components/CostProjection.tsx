"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { UI, BUDGET_COLORS, AGENT_COLORS, AGENT_LABELS } from "@/lib/colors";
import type { AgentType } from "@/lib/types";
import { COST_WARNING_PERCENT, COST_CRITICAL_PERCENT } from "@/lib/config";
import { calculateTotalCost, formatCost } from "@/lib/costs";
import { calculateBurnRate, calculateProjection } from "@/lib/costProjection";

export function CostProjection() {
  const agents = useAgentStore((s) => s.agents);
  const activity = useAgentStore((s) => s.activity);
  const budgetThreshold = useAgentStore((s) => s.budgetThreshold);
  const setBudgetThreshold = useAgentStore((s) => s.setBudgetThreshold);
  const agentTypeBudgets = useAgentStore((s) => s.agentTypeBudgets);
  const setAgentTypeBudget = useAgentStore((s) => s.setAgentTypeBudget);

  const [open, setOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync budgetInput when budgetThreshold changes (hydration happens in the store)
  useEffect(() => {
    if (budgetThreshold !== null) {
      setBudgetInput(budgetThreshold.toString());
    } else {
      setBudgetInput("");
    }
  }, [budgetThreshold]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const totalCost = useMemo(() => calculateTotalCost(agents), [agents]);

  const burnRate = useMemo(
    () => calculateBurnRate(activity, agents),
    [activity, agents],
  );

  const elapsedMs = useMemo(() => {
    let earliest = Date.now();
    for (const agent of agents.values()) {
      if (agent.startTime < earliest) earliest = agent.startTime;
    }
    return Date.now() - earliest;
  }, [agents]);

  const projection = useMemo(
    () => calculateProjection(totalCost.total, burnRate, budgetThreshold, elapsedMs),
    [totalCost.total, burnRate, budgetThreshold, elapsedMs],
  );

  // Determine alert level
  const alertLevel: "ok" | "warning" | "critical" = useMemo(() => {
    if (budgetThreshold && budgetThreshold > 0) {
      if (projection.percentOfBudget >= COST_CRITICAL_PERCENT) return "critical";
      if (projection.percentOfBudget >= COST_WARNING_PERCENT) return "warning";
    }
    return "ok";
  }, [budgetThreshold, projection.percentOfBudget]);

  // Shared critical/warning color; each usage site supplies its own "ok" fallback
  const alertColor =
    alertLevel === "critical"
      ? BUDGET_COLORS.critical
      : alertLevel === "warning"
        ? BUDGET_COLORS.warning
        : null;

  const statColor = alertColor ?? UI.primary;

  const handleBudgetSubmit = () => {
    const val = parseFloat(budgetInput);
    if (!isNaN(val) && val > 0) {
      setBudgetThreshold(val);
    } else if (budgetInput.trim() === "") {
      setBudgetThreshold(null);
    }
  };

  const formatTime = (minutes: number): string => {
    if (!isFinite(minutes) || minutes <= 0) return "--";
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Stat display - matches TopBar Stat style */}
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        className="text-sm bg-transparent border-none cursor-pointer p-0"
        style={{ color: UI.text.muted }}
      >
        COST:{" "}
        <span
          className="font-mono"
          style={{
            color: statColor,
            textShadow: `0 0 6px ${statColor}66`,
            animation:
              alertLevel === "critical"
                ? "cost-pulse-critical 1s ease-in-out infinite"
                : alertLevel === "warning"
                  ? "cost-pulse-warning 1.5s ease-in-out infinite"
                  : undefined,
          }}
        >
          {formatCost(totalCost.total)}
        </span>
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute z-50 rounded-lg p-3 text-xs font-mono"
          style={{
            bottom: "calc(100% + 12px)",
            right: 0,
            minWidth: 240,
            background: "var(--color-panel)",
            border: `1px solid var(--color-border)`,
            boxShadow: `0 0 20px rgba(0, 0, 0, 0.6), 0 0 8px ${UI.primary}22`,
          }}
        >
          {/* Arrow */}
          <div
            style={{
              position: "absolute",
              bottom: -6,
              right: 16,
              width: 12,
              height: 12,
              background: "var(--color-panel)",
              border: `1px solid var(--color-border)`,
              borderTop: "none",
              borderLeft: "none",
              transform: "rotate(45deg)",
            }}
          />

          {/* Burn Rate */}
          <div className="flex justify-between mb-2">
            <span style={{ color: UI.text.secondary }}>Burn Rate</span>
            <span style={{ color: burnRate > 0 ? UI.primary : UI.text.muted }}>
              {burnRate > 0 ? `$${burnRate.toFixed(4)}/min` : "idle"}
            </span>
          </div>

          {/* Projected Total */}
          {burnRate > 0 && (
            <div className="flex justify-between mb-2">
              <span style={{ color: UI.text.secondary }}>Projected</span>
              <span style={{ color: UI.text.primary }}>
                {formatCost(projection.projectedTotal)}
              </span>
            </div>
          )}

          {/* Time to Budget */}
          {budgetThreshold && budgetThreshold > 0 && burnRate > 0 && (
            <div className="flex justify-between mb-2">
              <span style={{ color: UI.text.secondary }}>Time to Limit</span>
              <span style={{ color: alertColor ?? UI.text.primary }}>
                {formatTime(projection.timeToThreshold)}
              </span>
            </div>
          )}

          {/* Budget Progress Bar */}
          {budgetThreshold && budgetThreshold > 0 && (
            <div className="mb-3">
              <div className="flex justify-between mb-1">
                <span style={{ color: UI.text.secondary }}>Budget</span>
                <span style={{ color: UI.text.primary }}>
                  {formatCost(totalCost.total)} / ${budgetThreshold.toFixed(2)}
                </span>
              </div>
              <div
                className="w-full rounded-full overflow-hidden"
                style={{
                  height: 4,
                  background: "var(--color-border)",
                }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(projection.percentOfBudget, 100)}%`,
                    background: alertColor ?? BUDGET_COLORS.ok,
                    boxShadow: alertColor ? `0 0 6px ${alertColor}88` : undefined,
                  }}
                />
              </div>
              <div
                className="text-right mt-0.5"
                style={{ color: UI.text.muted, fontSize: 10 }}
              >
                {projection.percentOfBudget.toFixed(1)}%
              </div>
            </div>
          )}

          {/* Separator */}
          <div
            className="my-2"
            style={{ borderTop: `1px solid var(--color-border)` }}
          />

          {/* Budget Input */}
          <div>
            <label
              className="block mb-1"
              style={{ color: UI.text.secondary, fontSize: 10 }}
            >
              BUDGET LIMIT ($)
            </label>
            <div className="flex gap-1">
              <input
                type="number"
                min="0"
                step="0.5"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBudgetSubmit();
                }}
                onBlur={handleBudgetSubmit}
                placeholder="e.g. 5.00"
                className="flex-1 rounded px-2 py-1 text-xs outline-none"
                style={{
                  background: "var(--color-border)",
                  color: UI.text.primary,
                  border: `1px solid ${UI.primary}33`,
                }}
              />
              {budgetThreshold !== null && (
                <button
                  onClick={() => {
                    setBudgetThreshold(null);
                    setBudgetInput("");
                  }}
                  className="rounded px-2 py-1 text-xs"
                  style={{
                    background: `${UI.error}22`,
                    color: UI.error,
                    border: `1px solid ${UI.error}44`,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* F3: Per-Type Token Budgets */}
          {(() => {
            const activeTypes = new Set<AgentType>();
            for (const a of agents.values()) {
              if (a.status !== "completed" && a.status !== "error") {
                activeTypes.add(a.agentType);
              }
            }
            if (activeTypes.size === 0) return null;
            return (
              <>
                <div
                  className="my-2"
                  style={{ borderTop: `1px solid var(--color-border)` }}
                />
                <div>
                  <label
                    className="block mb-1"
                    style={{ color: UI.text.secondary, fontSize: 10 }}
                  >
                    PER-TYPE TOKEN BUDGETS
                  </label>
                  <div className="space-y-1">
                    {Array.from(activeTypes).sort().map((type) => (
                      <div key={type} className="flex items-center gap-1">
                        <span
                          className="text-xs w-14 truncate"
                          style={{ color: AGENT_COLORS[type] }}
                        >
                          {AGENT_LABELS[type]}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1000"
                          value={agentTypeBudgets[type] ?? ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            setAgentTypeBudget(type, isNaN(val) || val <= 0 ? null : val);
                          }}
                          placeholder="tokens"
                          className="flex-1 rounded px-1.5 py-0.5 text-xs outline-none"
                          style={{
                            background: "var(--color-border)",
                            color: UI.text.primary,
                            border: `1px solid ${AGENT_COLORS[type]}33`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Pulse animations */}
      <style jsx>{`
        @keyframes cost-pulse-warning {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes cost-pulse-critical {
          0%, 100% { opacity: 1; text-shadow: 0 0 6px ${BUDGET_COLORS.critical}66; }
          50% { opacity: 0.7; text-shadow: 0 0 16px ${BUDGET_COLORS.critical}, 0 0 30px ${BUDGET_COLORS.critical}88; }
        }
      `}</style>
    </div>
  );
}
