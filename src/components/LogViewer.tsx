"use client";

import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { UI } from "@/lib/colors";
import { truncateId, formatTimestamp } from "@/lib/utils";
import { ModalBackdrop } from "./ModalBackdrop";

export function LogViewer() {
  const logViewerAgentId = useAgentStore((s) => s.logViewerAgentId);
  const logEntries = useAgentStore((s) => s.logEntries);
  const logLoading = useAgentStore((s) => s.logLoading);
  const closeLogViewer = useAgentStore((s) => s.closeLogViewer);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "system" | "user" | "assistant" | "tools">("all");
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  if (!logViewerAgentId) return null;

  const entries = logEntries.get(logViewerAgentId) || [];
  const isLoading = logLoading.has(logViewerAgentId);

  const roleFiltered = roleFilter === "all"
    ? entries
    : roleFilter === "tools"
      ? entries.filter((e) => e.toolCalls && e.toolCalls.length > 0)
      : entries.filter((e) => e.role === roleFilter);

  const filtered = search
    ? roleFiltered.filter(
        (e) =>
          e.content.toLowerCase().includes(search.toLowerCase()) ||
          e.toolCalls?.some(
            (tc) =>
              tc.name.toLowerCase().includes(search.toLowerCase()) ||
              tc.input.toLowerCase().includes(search.toLowerCase()) ||
              (tc.result && tc.result.toLowerCase().includes(search.toLowerCase()))
          )
      )
    : roleFiltered;

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case "user":
        return "#00f5ff";
      case "assistant":
        return UI.success;
      case "system":
        return "#6b7280";
      default:
        return "#94a3b8";
    }
  };


  return (
    <ModalBackdrop onClose={closeLogViewer}>
      <div
        style={{
          width: "80%",
          height: "80%",
          backgroundColor: "var(--color-panel, #0d1117)",
          border: "1px solid var(--color-border, #1e293b)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border, #1e293b)",
          }}
        >
          <span style={{ color: UI.primary, fontWeight: 600, fontSize: 14 }}>
            Agent Log: {truncateId(logViewerAgentId, 12)}
          </span>
          <button
            onClick={closeLogViewer}
            style={{
              background: "none",
              border: "none",
              color: UI.text.secondary,
              fontSize: 18,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--color-border, #1e293b)" }}>
          <input
            type="text"
            placeholder="Search log entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px",
              backgroundColor: "var(--color-bg, #010409)",
              border: "1px solid var(--color-border, #1e293b)",
              borderRadius: 4,
              color: UI.text.primary,
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        {/* Role filter tabs */}
        <div style={{ display: "flex", gap: 4, padding: "8px 16px", borderBottom: "1px solid var(--color-border, #1e293b)" }}>
          {(["all", "system", "user", "assistant", "tools"] as const).map((role) => {
            const isActive = roleFilter === role;
            const color = role === "all" ? "#94a3b8" : role === "tools" ? UI.tool : roleBadgeColor(role);
            return (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  padding: "2px 8px",
                  borderRadius: 9999,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  background: isActive ? `${color}22` : "transparent",
                  color: isActive ? color : UI.text.muted,
                  border: isActive ? `1px solid ${color}` : "1px solid var(--color-border, #1e293b)",
                }}
              >
                {role === "all" ? "All" : role.charAt(0).toUpperCase() + role.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Entries */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
          {isLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: UI.text.secondary,
                fontSize: 14,
              }}
            >
              Loading log entries...
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: UI.text.muted,
                fontSize: 14,
              }}
            >
              {search ? "No matching entries" : "No log entries available"}
            </div>
          ) : (
            filtered.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  backgroundColor: entry.role === "system" ? `${UI.text.muted}11` : "var(--color-bg, #010409)",
                  borderRadius: 4,
                  border: "1px solid var(--color-border, #1e293b)",
                }}
              >
                {/* Entry header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: entry.content || entry.toolCalls ? 6 : 0,
                  }}
                >
                  <span style={{ color: UI.text.muted, fontSize: 11, fontFamily: "monospace" }}>
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      padding: "1px 6px",
                      borderRadius: 3,
                      backgroundColor: roleBadgeColor(entry.role) + "22",
                      color: roleBadgeColor(entry.role),
                      letterSpacing: "0.05em",
                    }}
                  >
                    {entry.role}
                  </span>
                  {entry.role === "system" && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(entry.content).catch(() => {}); }}
                      style={{
                        fontSize: 10,
                        padding: "1px 4px",
                        borderRadius: 3,
                        background: `${UI.text.muted}22`,
                        color: UI.text.secondary,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Copy
                    </button>
                  )}
                </div>

                {/* Content */}
                {entry.content && (
                  <div
                    style={{
                      color: UI.text.primary,
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {entry.content}
                  </div>
                )}

                {/* Tool calls */}
                {entry.toolCalls &&
                  entry.toolCalls.map((tc) => {
                    const isExpanded = expandedTools.has(tc.id);
                    return (
                      <div
                        key={tc.id}
                        style={{
                          marginTop: 6,
                          border: `1px solid ${UI.tool}33`,
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        <button
                          onClick={() => toggleTool(tc.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "100%",
                            padding: "4px 8px",
                            background: `${UI.tool}11`,
                            border: "none",
                            color: UI.tool,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: 10 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                          {tc.name}
                        </button>
                        {isExpanded && (
                          <div style={{ padding: "6px 8px" }}>
                            <div style={{ marginBottom: 4 }}>
                              <span style={{ color: UI.text.muted, fontSize: 11 }}>Input:</span>
                              <pre
                                style={{
                                  color: UI.text.secondary,
                                  fontSize: 11,
                                  fontFamily: "monospace",
                                  margin: "2px 0",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  maxHeight: 200,
                                  overflowY: "auto",
                                }}
                              >
                                {tc.input}
                              </pre>
                            </div>
                            {tc.result && (
                              <div>
                                <span style={{ color: UI.text.muted, fontSize: 11 }}>Result:</span>
                                <pre
                                  style={{
                                    color: UI.text.secondary,
                                    fontSize: 11,
                                    fontFamily: "monospace",
                                    margin: "2px 0",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    maxHeight: 200,
                                    overflowY: "auto",
                                  }}
                                >
                                  {tc.result}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
