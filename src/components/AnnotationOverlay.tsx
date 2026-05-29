"use client";

import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { UI, ANNOTATION_COLOR } from "@/lib/colors";
import { formatTimestampShort } from "@/lib/utils";
import type { Annotation } from "@/lib/types";
const CURRENT_USER = "viewer";

interface AnnotationOverlayProps {
  agentId: string;
}

export function AnnotationOverlay({ agentId }: AnnotationOverlayProps) {
  const annotations = useAgentStore((s) => s.annotations);
  const agentAnnotations = Array.from(annotations.values()).filter((a) => a.targetId === agentId);
  const [newText, setNewText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const text = newText.trim();
    if (!text) return;

    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const annotation: Annotation = {
      id,
      targetId: agentId,
      targetType: "agent",
      text,
      author: CURRENT_USER,
      timestamp: Date.now(),
    };

    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(annotation),
      });
      if (!res.ok) {
        const { error: errMsg } = await res.json().catch(() => ({ error: res.statusText }));
        setError(errMsg ?? "Failed to save annotation");
        return;
      }
      setNewText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save annotation");
    }
  }

  function handleRemove(id: string) {
    void (async () => {
      try {
        const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          setError(`Failed to remove annotation: ${res.statusText}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove annotation");
      }
    })();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAdd();
    }
  }


  return (
    <div>
      {agentAnnotations.length > 0 && (
        <div
          className="flex items-center gap-1 mb-2"
          style={{ color: ANNOTATION_COLOR }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-xs font-medium">
            {agentAnnotations.length} annotation{agentAnnotations.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="space-y-1.5">
        {agentAnnotations.map((ann) => (
          <div
            key={ann.id}
            className="text-xs rounded px-2 py-1.5 group"
            style={{
              background: `${ANNOTATION_COLOR}11`,
              border: `1px solid ${ANNOTATION_COLOR}33`,
            }}
          >
            <div className="flex items-start justify-between gap-1">
              <span style={{ color: UI.text.primary }}>{ann.text}</span>
              {ann.author === CURRENT_USER && (
                <button
                  onClick={() => handleRemove(ann.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  style={{ color: UI.error }}
                  title="Remove annotation"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-0.5" style={{ color: UI.text.dimmed }}>
              <span>{ann.author}</span>
              <span>{formatTimestampShort(ann.timestamp)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mt-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => {
            setNewText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add annotation..."
          className="flex-1 text-xs rounded px-2 py-1 outline-none"
          style={{
            background: "var(--color-border)",
            color: UI.text.primary,
            border: "1px solid transparent",
          }}
        />
        <button
          onClick={() => { void handleAdd(); }}
          disabled={!newText.trim()}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{
            background: newText.trim() ? ANNOTATION_COLOR : `${ANNOTATION_COLOR}33`,
            color: newText.trim() ? "#000" : UI.text.dimmed,
            cursor: newText.trim() ? "pointer" : "default",
          }}
        >
          Add
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="text-xs mt-1"
          style={{ color: UI.error }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
