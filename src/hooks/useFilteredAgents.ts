"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  return useMemo(() => {
    let list = Array.from(agents.values());
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
