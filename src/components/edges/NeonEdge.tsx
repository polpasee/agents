"use client";

import { memo } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

interface NeonEdgeData {
  color: string;
  animated: boolean;
  [key: string]: unknown;
}

function NeonEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const { color = "#94a3b8", animated = false } = (data || {}) as NeonEdgeData;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 20,
  });

  return (
    <>
      {/* Glow layer */}
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 6,
          strokeOpacity: 0.15,
          filter: `blur(4px)`,
        }}
      />
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeOpacity: 0.6,
          strokeDasharray: animated ? "8 4" : "none",
          animation: animated ? "dash-flow 0.8s linear infinite" : "none",
        }}
      />
      {/* Animated particles */}
      {animated && (
        <>
          <circle r={3} fill={color} filter={`drop-shadow(0 0 4px ${color})`}>
            <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle
            r={2}
            fill={color}
            opacity={0.6}
            filter={`drop-shadow(0 0 3px ${color})`}
          >
            <animateMotion
              dur="2s"
              repeatCount="indefinite"
              path={edgePath}
              begin="0.7s"
            />
          </circle>
          <circle
            r={2}
            fill={color}
            opacity={0.4}
            filter={`drop-shadow(0 0 2px ${color})`}
          >
            <animateMotion
              dur="2s"
              repeatCount="indefinite"
              path={edgePath}
              begin="1.4s"
            />
          </circle>
        </>
      )}
    </>
  );
}

export const NeonEdge = memo(NeonEdgeComponent);
