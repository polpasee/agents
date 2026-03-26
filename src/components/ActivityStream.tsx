"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS } from "@/lib/colors";
import type { AgentEvent } from "@/lib/types";

export function ActivityStream() {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity]);

  return (
    <div
      className="flex flex-col"
      style={{
        height: 160,
        background: "var(--color-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        className="px-3 py-1.5 text-xs uppercase tracking-wider flex-shrink-0"
        style={{ color: "#666", borderBottom: "1px solid var(--color-border)" }}
      >
        Activity Stream
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar px-3 py-1 space-y-0.5"
      >
        {activity.length === 0 && (
          <div className="text-sm text-center py-4" style={{ color: "#444" }}>
            Waiting for agent activity...
          </div>
        )}
        {activity.map((entry) => (
          <ActivityLine
            key={entry.id}
            timestamp={entry.timestamp}
            event={entry.event}
            agents={agents}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityLine({
  timestamp,
  event,
  agents,
}: {
  timestamp: number;
  event: AgentEvent;
  agents: Map<string, { agentType: string }>;
}) {
  const time = new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const getAgentColor = (id: string) => {
    const agent = agents.get(id);
    return agent
      ? AGENT_COLORS[agent.agentType as keyof typeof AGENT_COLORS] || "#94a3b8"
      : "#94a3b8";
  };

  let content: React.ReactNode;

  switch (event.type) {
    case "agent:register":
      content = (
        <>
          {event.parentId && (
            <>
              <span style={{ color: getAgentColor(event.parentId) }}>
                {event.parentId.slice(0, 8)}
              </span>
              {" spawned "}
            </>
          )}
          <span style={{ color: getAgentColor(event.agentId) }}>
            {event.agentType}:{event.agentId.slice(0, 8)}
          </span>
          {" — "}
          <span style={{ color: "#666" }}>&quot;{event.task}&quot;</span>
        </>
      );
      break;
    case "agent:status":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {event.agentId.slice(0, 8)}
          </span>
          {" → "}
          <span className="capitalize">{event.status}</span>
          {event.message && (
            <span style={{ color: "#666" }}> — {event.message}</span>
          )}
        </>
      );
      break;
    case "agent:tool_call":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {event.agentId.slice(0, 8)}
          </span>
          {" called "}
          <span style={{ color: "#ffaa00" }}>{event.tool}</span>
          {event.args && (
            <span style={{ color: "#666" }}> — {event.args}</span>
          )}
        </>
      );
      break;
    case "agent:message":
      content = (
        <>
          <span style={{ color: getAgentColor(event.fromId) }}>
            {event.fromId.slice(0, 8)}
          </span>
          {" → "}
          <span style={{ color: getAgentColor(event.toId) }}>
            {event.toId.slice(0, 8)}
          </span>
          {" — "}
          <span style={{ color: "#666" }}>&quot;{event.content}&quot;</span>
        </>
      );
      break;
    case "agent:complete":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {event.agentId.slice(0, 8)}
          </span>
          {" completed"}
          {event.summary && (
            <span style={{ color: "#666" }}> — {event.summary}</span>
          )}
        </>
      );
      break;
    case "agent:tokens":
      return null; // Don't spam token updates in activity
    default:
      return null;
  }

  return (
    <div className="text-sm leading-relaxed animate-fade-in-up" style={{ color: "#475569" }}>
      <span style={{ color: "#00f5ff" }}>{time}</span> {content}
    </div>
  );
}
