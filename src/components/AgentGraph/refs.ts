import { useRef, useMemo } from "react";
import type { Simulation, ZoomBehavior } from "d3";
import type { SimNode, SimLink } from "@/lib/d3";

export interface LifecycleEffect {
  x: number;
  y: number;
  color: string;
  type: "spawn" | "complete" | "error";
  startTime: number;
  duration: number;
  effectRadius: number;
}

/**
 * Refs shared across the AgentGraph hook layer. Each hook documents which
 * fields it reads vs writes in its own header comment.
 */
export interface AgentGraphRefs {
  svgRef: React.RefObject<SVGSVGElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  simulationRef: React.MutableRefObject<Simulation<SimNode, SimLink> | null>;
  nodesRef: React.MutableRefObject<SimNode[]>;
  linksRef: React.MutableRefObject<SimLink[]>;
  toolNodesRef: React.MutableRefObject<SimNode[]>;
  toolLinksRef: React.MutableRefObject<SimLink[]>;
  zoomRef: React.MutableRefObject<ZoomBehavior<SVGSVGElement, unknown> | null>;
  effectsRef: React.MutableRefObject<LifecycleEffect[]>;
  prevActivityLenRef: React.MutableRefObject<number>;
}

export function useAgentGraphRefs(): AgentGraphRefs {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const toolNodesRef = useRef<SimNode[]>([]);
  const toolLinksRef = useRef<SimLink[]>([]);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const effectsRef = useRef<LifecycleEffect[]>([]);
  const prevActivityLenRef = useRef(0);

  return useMemo(
    () => ({
      svgRef,
      containerRef,
      simulationRef,
      nodesRef,
      linksRef,
      toolNodesRef,
      toolLinksRef,
      zoomRef,
      effectsRef,
      prevActivityLenRef,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
