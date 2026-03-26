"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AGENT_COLORS, STATUS_COLORS, AGENT_LABELS } from "@/lib/colors";
import type { AgentType } from "@/lib/types";
import { useAgentStore } from "@/lib/store";

interface AgentNodeData {
  agent: import("@/lib/types").AgentState;
  selected: boolean;
  [key: string]: unknown;
}

const P = 4; // pixel unit size

// ── Pixel art sprite definitions (8×10 grids) ──────────────────
const SPRITES: Record<AgentType, number[][]> = {
  main: [
    [0,0,0,1,1,0,0,0],
    [0,0,0,1,1,0,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [1,1,0,0,0,0,1,1],
    [1,1,1,0,0,1,1,1],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  explore: [
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,0,0,1,1,0,0,1],
    [1,1,0,1,1,0,1,1],
    [0,1,1,1,1,1,1,0],
    [0,1,0,0,0,0,1,0],
    [0,1,1,0,0,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  plan: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,0,0,1,1,0],
    [0,1,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  build: [
    [0,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,0,1,1,0,1,0],
    [0,1,1,0,0,1,1,0],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  review: [
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,1,0,0,1,1,1],
    [1,0,1,0,0,1,0,1],
    [1,1,1,1,1,1,1,1],
    [0,1,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  test: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,0,0,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  "team-lead": [
    [1,0,1,0,0,1,0,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,1,1,1,1,0],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,0,1,1,0,1,0],
    [0,1,1,0,0,1,1,0],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
  generic: [
    [0,0,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1],
    [1,1,0,1,1,0,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,0],
    [0,0,1,0,0,1,0,0],
    [0,1,1,0,0,1,1,0],
  ],
};

// ── Pixel art speech bubble sprite (border frame) ──────────────
// Inspired by pixel-agents: a pixel grid bubble with stepped corners + tail
// B = border, F = fill, _ = transparent
const BUBBLE_PALETTE = { B: "#555566", F: "#1a1a2e", _: "" };

function spriteToBoxShadow(sprite: number[][], color: string): string {
  const shadows: string[] = [];
  for (let y = 0; y < sprite.length; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      if (sprite[y][x]) {
        shadows.push(`${x * P}px ${y * P}px 0 0 ${color}`);
      }
    }
  }
  return shadows.join(",");
}

// ── Pixel art speech bubble component ──────────────────────────
function PixelBubble({ text, color }: { text: string; color: string }) {
  const displayText = text.slice(0, 50);

  return (
    <div
      style={{
        position: "relative",
        imageRendering: "pixelated",
      }}
    >
      {/* Bubble body with pixel-stepped corners */}
      <div
        style={{
          background: BUBBLE_PALETTE.F,
          padding: "6px 8px",
          minWidth: 48,
          maxWidth: 200,
          fontFamily: "monospace",
          fontSize: 9,
          lineHeight: "13px",
          color: "#c9d1d9",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          // Pixel-stepped border using outline + clip-path
          border: `2px solid ${BUBBLE_PALETTE.B}`,
          clipPath: `polygon(
            ${P}px 0%, calc(100% - ${P}px) 0%,
            100% ${P}px, 100% calc(100% - ${P}px),
            calc(100% - ${P}px) 100%, ${P * 4}px 100%,
            ${P * 4}px calc(100% + ${P * 2}px),
            ${P * 2}px calc(100% + ${P}px),
            ${P * 2}px 100%, ${P}px 100%,
            0% calc(100% - ${P}px), 0% ${P}px
          )`,
          boxShadow: `0 0 8px ${color}22`,
        }}
      >
        {displayText}
      </div>
      {/* Pixel tail — rendered as small blocks */}
      <div style={{ position: "relative", height: P * 2 }}>
        <div
          style={{
            position: "absolute",
            left: P * 2,
            top: 0,
            width: P * 2,
            height: P,
            background: BUBBLE_PALETTE.B,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: P * 3,
            top: 0,
            width: P,
            height: P,
            background: BUBBLE_PALETTE.F,
          }}
        />
      </div>
    </div>
  );
}

// ── Main node component ────────────────────────────────────────
function AgentNodeComponent({ data }: NodeProps) {
  const { agent, selected } = data as unknown as AgentNodeData;
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const color = AGENT_COLORS[agent.agentType];
  const statusColor = STATUS_COLORS[agent.status];
  const label = AGENT_LABELS[agent.agentType];

  const totalTokens = agent.inputTokens + agent.outputTokens;
  const tokenPercent =
    agent.contextWindow > 0
      ? Math.min((totalTokens / agent.contextWindow) * 100, 100)
      : 0;

  const isActive = agent.status === "running";
  const isError = agent.status === "error";

  const lastTool =
    agent.toolCalls.length > 0
      ? agent.toolCalls[agent.toolCalls.length - 1].tool
      : null;
  const statusLabel = isActive && lastTool
    ? lastTool
    : agent.status === "idle"
      ? "sleep"
      : agent.status;

  const sprite = SPRITES[agent.agentType] || SPRITES.generic;
  const spriteW = sprite[0].length * P;
  const spriteH = sprite.length * P;

  return (
    <div
      className={`relative cursor-pointer ${isError ? "animate-error-shake" : ""}`}
      onClick={() => selectAgent(agent.id)}
      style={{ imageRendering: "pixelated" }}
    >
      {/* Speech bubble — positioned to upper-right */}
      {agent.task && (
        <div
          className="absolute"
          style={{
            bottom: "55%",
            left: "60%",
          }}
        >
          <PixelBubble text={agent.task} color={color} />
        </div>
      )}

      {/* Character container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Glow */}
        {(selected || isActive) && (
          <div
            className="absolute"
            style={{
              inset: 0,
              boxShadow: `0 0 20px ${color}44, 0 0 40px ${color}22`,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Pixel art sprite */}
        <div
          className={isActive ? "animate-pixel-bounce" : ""}
          style={{
            position: "relative",
            width: spriteW,
            height: spriteH,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: P,
              height: P,
              boxShadow: spriteToBoxShadow(sprite, color),
              filter: selected ? `drop-shadow(0 0 3px ${color})` : undefined,
            }}
          />
        </div>

        {/* Label */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 8,
            fontWeight: "bold",
            color,
            letterSpacing: 2,
            marginTop: 4,
            textShadow: `0 0 6px ${color}66`,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>

        {/* Token progress bar (pixel style) */}
        <div
          style={{
            width: spriteW,
            height: P,
            background: `${color}22`,
            marginTop: 4,
          }}
        >
          <div
            style={{
              width: `${tokenPercent}%`,
              height: "100%",
              background: color,
              boxShadow: tokenPercent > 0 ? `0 0 4px ${color}` : undefined,
              transition: "width 0.5s ease",
            }}
          />
        </div>

        {/* Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            marginTop: 3,
          }}
        >
          <div
            style={{
              width: P,
              height: P,
              background: statusColor,
              boxShadow: `0 0 4px ${statusColor}`,
            }}
          />
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 8,
              color: statusColor,
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
