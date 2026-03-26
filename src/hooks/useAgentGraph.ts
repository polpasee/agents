"use client";

import { useMemo } from "react";
import { type Node, type Edge } from "@xyflow/react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS } from "@/lib/colors";

export function useAgentGraph() {
  const agents = useAgentStore((s) => s.agents);
  const edges = useAgentStore((s) => s.edges);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedSessionId = useAgentStore((s) => s.selectedSessionId);

  const filteredAgents = useMemo(() => {
    const all = Array.from(agents.values());
    if (!selectedSessionId) return all;
    return all.filter((a) => {
      const mainAgent = a.parentId ? agents.get(a.parentId) : a;
      const sid = mainAgent?.sessionId || mainAgent?.id;
      return sid === selectedSessionId;
    });
  }, [agents, selectedSessionId]);

  const nodes: Node[] = useMemo(() => {
    const agentList = filteredAgents;
    // Simple hierarchical layout
    const roots = agentList.filter((a) => !a.parentId);
    const childrenMap = new Map<string, typeof agentList>();
    for (const agent of agentList) {
      if (agent.parentId) {
        const siblings = childrenMap.get(agent.parentId) || [];
        siblings.push(agent);
        childrenMap.set(agent.parentId, siblings);
      }
    }

    const result: Node[] = [];
    let rootX = 0;

    function layoutAgent(agentId: string, x: number, y: number): number {
      const agent = agents.get(agentId);
      if (!agent) return x;

      result.push({
        id: agent.id,
        type: "agentNode",
        position: { x, y },
        data: {
          agent,
          selected: agent.id === selectedAgentId,
        },
      });

      const children = childrenMap.get(agentId) || [];
      if (children.length === 0) return x;

      const totalWidth = children.length * 200;
      let childX = x - totalWidth / 2 + 100;

      for (const child of children) {
        layoutAgent(child.id, childX, y + 180);
        childX += 200;
      }

      return x;
    }

    for (const root of roots) {
      layoutAgent(root.id, rootX, 50);
      rootX += 400;
    }

    return result;
  }, [filteredAgents, agents, selectedAgentId]);

  const filteredAgentIds = useMemo(
    () => new Set(filteredAgents.map((a) => a.id)),
    [filteredAgents]
  );

  const flowEdges: Edge[] = useMemo(() => {
    return edges.filter((e) => filteredAgentIds.has(e.source) && filteredAgentIds.has(e.target)).map((e) => {
      const targetAgent = agents.get(e.target);
      const color = targetAgent
        ? AGENT_COLORS[targetAgent.agentType]
        : "#94a3b8";

      return {
        id: `${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: "neonEdge",
        data: { color, animated: targetAgent?.status === "running" },
      };
    });
  }, [edges, agents, filteredAgentIds]);

  return { nodes, edges: flowEdges };
}
