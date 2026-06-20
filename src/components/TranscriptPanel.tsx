"use client";

import { useState, useRef, useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { AGENT_COLORS, UI } from "@/lib/colors";
import { truncateId, formatTimestamp } from "@/lib/utils";

export function TranscriptPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity]);

  if (!open) return null;

  const filtered = search
    ? activity.filter((e) => {
        const str = JSON.stringify(e.event).toLowerCase();
        return str.includes(search.toLowerCase());
      })
    : activity;

  return (
    <div
      className="absolute left-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden"
      style={{
        width: 360,
        background: "var(--color-panel)",
        borderRight: "1px solid var(--color-border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span
          className="text-xs uppercase tracking-wider font-mono"
          style={{ color: UI.text.muted }}
        >
          Transcript ({filtered.length}/{activity.length})
        </span>
        <button
          onClick={onClose}
          className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{
            color: UI.text.muted,
            border: "1px solid var(--color-border)",
          }}
          aria-label="Close transcript panel"
        >
          x
        </button>
      </div>

      {/* Search */}
      <div
        className="px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter messages..."
          className="w-full text-xs font-mono rounded px-2 py-1 outline-none"
          style={{
            background: "var(--color-border)",
            color: UI.text.secondary,
            border: `1px solid ${UI.primary}22`,
          }}
        />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1"
      >
        {filtered.map((entry) => {
          const event = entry.event;
          const time = formatTimestamp(entry.timestamp);

          let agentId = "";
          let color: string = UI.text.muted;
          let content = "";

          switch (event.type) {
            case "agent:register": {
              agentId = event.agentId;
              const a = agents.get(agentId);
              color = a ? AGENT_COLORS[a.agentType] : UI.primary;
              content = `Spawned: ${event.task}`;
              break;
            }
            case "agent:tool_call":
              agentId = event.agentId;
              color = UI.tool;
              content = `${event.tool}${event.args ? ` — ${event.args}` : ""}`;
              break;
            case "agent:status":
              agentId = event.agentId;
              color = event.status === "error" ? UI.error : UI.text.dimmed;
              content = `Status → ${event.status}`;
              break;
            case "agent:complete":
              agentId = event.agentId;
              color = UI.success;
              content = `Completed${event.summary ? `: ${event.summary.slice(0, 100)}` : ""}`;
              break;
            case "agent:tokens":
              return null; // skip tokens
            case "agent:message":
              agentId = event.fromId;
              color = UI.primary;
              content = `→ ${truncateId(event.toId)}: ${event.content}`;
              break;
          }

          if (!content) return null;

          return (
            <div
              key={entry.id}
              className="rounded px-2 py-1"
              style={{
                background: `${color}08`,
                borderLeft: `2px solid ${color}44`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono"
                  style={{ color: UI.text.dimmed }}
                >
                  {time}
                </span>
                <span className="text-xs font-mono font-bold" style={{ color }}>
                  {truncateId(agentId)}
                </span>
              </div>
              <div
                className="text-xs font-mono mt-0.5 break-words"
                style={{ color: UI.text.secondary }}
              >
                {content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
