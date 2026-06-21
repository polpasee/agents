"use client";

import { useEffect, useRef } from "react";
import { UI } from "@/lib/colors";
import type { AgentGraphHandle } from "./AgentGraph";

export function MiniMap({
  graphRef,
}: {
  graphRef: React.RefObject<AgentGraphHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const node = canvas;

    let frameId: ReturnType<typeof requestAnimationFrame>;
    let stopped = false;

    function draw() {
      if (stopped) return;
      const ctx = node.getContext("2d");
      if (!ctx) return;

      const w = node.width;
      const h = node.height;
      ctx.clearRect(0, 0, w, h);

      const data = graphRef.current?.getNodesAndViewport();
      if (data && data.nodes.length > 0) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const n of data.nodes) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x);
          maxY = Math.max(maxY, n.y);
        }
        const pad = 60;
        minX -= pad;
        minY -= pad;
        maxX += pad;
        maxY += pad;
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const scale = Math.min(w / rangeX, h / rangeY);

        for (const n of data.nodes) {
          const x = (n.x - minX) * scale;
          const y = (n.y - minY) * scale;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = n.color;
          ctx.fill();
        }

        const vp = data.viewport;
        const rx = (vp.x - minX) * scale;
        const ry = (vp.y - minY) * scale;
        const rw = vp.width * scale;
        const rh = vp.height * scale;
        ctx.strokeStyle = UI.primary;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.globalAlpha = 1;
      }

      if (!stopped) {
        frameId = requestAnimationFrame(draw);
      }
    }

    frameId = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
    };
  }, [graphRef]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={100}
      role="img"
      aria-label="Agent graph minimap"
      className="absolute bottom-2 right-2 rounded"
      style={{
        background: `${UI.text.empty}33`,
        border: "1px solid var(--color-border)",
      }}
    />
  );
}
