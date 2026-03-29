"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import type { AgentGraphHandle } from "@/components/AgentGraph";

/** Register global keyboard shortcuts for graph navigation (Esc, F, Arrow keys). */
export function useKeyboardShortcuts(graphRef: React.RefObject<AgentGraphHandle | null>) {
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      switch (e.key) {
        case "Escape":
          selectAgent(null);
          break;
        case "f":
        case "F":
          graphRef.current?.fitToView();
          break;
        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const agentIds = Array.from(agents.keys());
          if (agentIds.length === 0) break;
          const currentIdx = selectedAgentId ? agentIds.indexOf(selectedAgentId) : -1;
          const nextIdx = e.key === "ArrowDown"
            ? (currentIdx + 1) % agentIds.length
            : (currentIdx - 1 + agentIds.length) % agentIds.length;
          selectAgent(agentIds[nextIdx]);
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectAgent, selectedAgentId, agents, graphRef]);
}
