import { useRef } from "react";
import type * as d3 from "d3";
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
  simulationRef: React.MutableRefObject<d3.Simulation<SimNode, SimLink> | null>;
  nodesRef: React.MutableRefObject<SimNode[]>;
  linksRef: React.MutableRefObject<SimLink[]>;
  toolNodesRef: React.MutableRefObject<SimNode[]>;
  toolLinksRef: React.MutableRefObject<SimLink[]>;
  zoomRef: React.MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  effectsRef: React.MutableRefObject<LifecycleEffect[]>;
  prevActivityLenRef: React.MutableRefObject<number>;
}

export function useAgentGraphRefs(): AgentGraphRefs {
  return {
    svgRef: useRef<SVGSVGElement>(null),
    containerRef: useRef<HTMLDivElement>(null),
    simulationRef: useRef<d3.Simulation<SimNode, SimLink> | null>(null),
    nodesRef: useRef<SimNode[]>([]),
    linksRef: useRef<SimLink[]>([]),
    toolNodesRef: useRef<SimNode[]>([]),
    toolLinksRef: useRef<SimLink[]>([]),
    zoomRef: useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null),
    effectsRef: useRef<LifecycleEffect[]>([]),
    prevActivityLenRef: useRef(0),
  };
}
