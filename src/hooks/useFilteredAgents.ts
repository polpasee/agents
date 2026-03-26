"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);

  return useMemo(() => {
    const all = Array.from(agents.values());
    if (!selectedSessionId) return all;
    return all.filter((a) => {
      const mainAgent = a.parentId ? agents.get(a.parentId) : a;
      const sid = mainAgent?.sessionId || mainAgent?.id;
      return sid === selectedSessionId;
    });
  }, [agents, selectedSessionId]);
}
