"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, UI } from "@/lib/colors";
import { truncateId } from "@/lib/utils";
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
          <div className="text-sm text-center py-4" style={{ color: UI.text.empty }}>
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
                {truncateId(event.parentId)}
              </span>
              {" spawned "}
            </>
          )}
          <span style={{ color: getAgentColor(event.agentId) }}>
            {event.agentType}:{truncateId(event.agentId)}
          </span>
          {" — "}
          <span style={{ color: UI.text.muted }}>&quot;{event.task}&quot;</span>
        </>
      );
      break;
    case "agent:status":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {truncateId(event.agentId)}
          </span>
          {" → "}
          <span className="capitalize">{event.status}</span>
          {event.message && (
            <span style={{ color: UI.text.muted }}> — {event.message}</span>
          )}
        </>
      );
      break;
    case "agent:tool_call":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {truncateId(event.agentId)}
          </span>
          {" called "}
          <span style={{ color: UI.tool }}>{event.tool}</span>
          {event.args && (
            <span style={{ color: UI.text.muted }}> — {event.args}</span>
          )}
        </>
      );
      break;
    case "agent:message":
      content = (
        <>
          <span style={{ color: getAgentColor(event.fromId) }}>
            {truncateId(event.fromId)}
          </span>
          {" → "}
          <span style={{ color: getAgentColor(event.toId) }}>
            {truncateId(event.toId)}
          </span>
          {" — "}
          <span style={{ color: UI.text.muted }}>&quot;{event.content}&quot;</span>
        </>
      );
      break;
    case "agent:complete":
      content = (
        <>
          <span style={{ color: getAgentColor(event.agentId) }}>
            {truncateId(event.agentId)}
          </span>
          {" completed"}
          {event.summary && (
            <span style={{ color: UI.text.muted }}> — {event.summary}</span>
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
    <div className="text-sm leading-relaxed animate-fade-in-up" style={{ color: UI.text.secondary }}>
      <span style={{ color: UI.primary }}>{time}</span> {content}
    </div>
  );
}
