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

    // If a sub-agent survived filtering but its parent was dropped, restore the parent
    // so sub-agent nodes are never rendered without a visible anchor.
    const listedIds = new Set(list.map((a) => a.id));
    for (const a of list) {
      if (a.parentId && !listedIds.has(a.parentId)) {
        const parent = agents.get(a.parentId);
        if (parent) {
          list.push(parent);
          listedIds.add(parent.id);
        }
      }
    }

    return list;
  }, [agents, selectedSessionIds, hiddenAgentTypes]);
}
