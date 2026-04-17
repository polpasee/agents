"use client";

import { useMemo, useState, useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { IDLE_TIMEOUT_MS } from "@/lib/config";

export function useFilteredAgents() {
  const agents = useAgentStore((s) => s.agents);
  const selectedSessionIds = useAgentStore((s) => s.selectedSessionIds);
  const hiddenAgentTypes = useAgentStore((s) => s.hiddenAgentTypes);

  // Tick every 5 s so the idle-timeout filter re-evaluates continuously rather
  // than only when the agents Map changes (which caused batch disappearances).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    let list = Array.from(agents.values());
    // Drop idle sub-agents after IDLE_TIMEOUT_MS. Main sessions are exempt —
    // they can legitimately idle (e.g. waiting on background bash) and the
    // server already purges truly-dead sessions via STALE_THRESHOLD_MS.
    list = list.filter((a) => {
      if (a.status !== "idle") return true;
      if (!a.parentId) return true;
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
  }, [agents, selectedSessionIds, hiddenAgentTypes, now]);
}
