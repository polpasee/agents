"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { IDLE_TIMEOUT_MS } from "@/lib/config";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  return useMemo(() => {
    const now = Date.now();
    let list = Array.from(agents.values());
    // Remove agents idle for more than 20s
    list = list.filter((a) => {
      if (a.status !== "idle") return true;
      const lastActivity = a.toolCalls.length > 0
        ? a.toolCalls[a.toolCalls.length - 1].timestamp
        : a.startTime;
      return now - lastActivity < IDLE_TIMEOUT_MS;
    });
    // F5: multi-session filter (empty set = show all)
    if (selectedSessionIds.size > 0) {
      list = list.filter((a) => {
        const mainAgent = a.parentId ? agents.get(a.parentId) : a;
        const sid = mainAgent?.sessionId || mainAgent?.id;
        return sid != null && selectedSessionIds.has(sid);
      });
    }
    if (hiddenAgentTypes.size > 0) {
      list = list.filter((a) => !hiddenAgentTypes.has(a.agentType));
    }
    return list;
  }, [agents, selectedSessionIds, hiddenAgentTypes]);
}
