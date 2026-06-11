"use client";

import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { resolveSessionId } from "@/lib/sessions";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  return useMemo(() => {
    // No idle-timeout filter — server-side STALE_THRESHOLD_MS is the single
    // source of truth for when an agent stops existing. A client filter that
    // drops "idle" agents on a shorter schedule hid sub-agents blocked on
    // long background tools (multi-minute `npm test` etc.) while the session
    // was still very much alive.
    let list = Array.from(agents.values());

    // F5: multi-session filter (empty set = show all)
    if (selectedSessionIds.size > 0) {
      list = list.filter((a) => {
        const sid = resolveSessionId(a, agents);
        return selectedSessionIds.has(sid);
      });
    }
    if (hiddenAgentTypes.size > 0) {
      list = list.filter((a) => !hiddenAgentTypes.has(a.agentType));
    }

    // If a sub-agent survived filtering but ancestors were dropped, restore the
    // full ancestor chain (nested sub-agents can be several levels deep) so
    // sub-agent nodes are never rendered without a visible anchor. The visited
    // set guards against parentId cycles.
    const listedIds = new Set(list.map((a) => a.id));
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const a of list) {
      if (a.parentId) queue.push(a.parentId);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (visited.has(id)) continue;
      visited.add(id);
      const ancestor = agents.get(id);
      if (!ancestor) continue;
      if (!listedIds.has(ancestor.id)) {
        list.push(ancestor);
        listedIds.add(ancestor.id);
      }
      if (ancestor.parentId) queue.push(ancestor.parentId);
    }

    return list;
  }, [agents, selectedSessionIds, hiddenAgentTypes]);
}
