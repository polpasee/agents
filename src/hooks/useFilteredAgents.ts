"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  return useMemo(() => {
    let list = Array.from(agents.values());
    if (selectedSessionId) {
      list = list.filter((a) => {
        const mainAgent = a.parentId ? agents.get(a.parentId) : a;
        const sid = mainAgent?.sessionId || mainAgent?.id;
        return sid === selectedSessionId;
      });
    }
    if (hiddenAgentTypes.size > 0) {
      list = list.filter((a) => !hiddenAgentTypes.has(a.agentType));
    }
    return list;
  }, [agents, selectedSessionId, hiddenAgentTypes]);
}
