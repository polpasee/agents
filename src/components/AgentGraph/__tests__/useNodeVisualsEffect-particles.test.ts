/**
 * useNodeVisualsEffect — PARTICLE EMISSION tests (lines ~110-169)
 *
 * Strategy: build a real SVG tree in jsdom with g.particles and g.links groups,
 * seed running/idle target agents so activeLinkIds is non-empty, and assert that
 * circle/animateMotion SVG elements are appended.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/d3", () => ({
  renderNodeVisuals: vi.fn(),
  updateLinkVisuals: vi.fn(),
  bezierPath: vi.fn(
    (sx: number, sy: number, tx: number, ty: number) =>
      `M${sx},${sy} C${sx},${sy} ${tx},${ty} ${tx},${ty}`,
  ),
  renderHeatmapNode: vi.fn(),
  renderHeatmapLegend: vi.fn(),
  computeMetricValue: vi.fn(() => 0),
  precomputeHeatmapNorms: vi.fn(() => ({})),
  createHeatmapScale: vi.fn(() => vi.fn(() => "#000")),
}));

vi.mock("@/lib/d3/endpointId", () => ({
  endpointId: (n: unknown) =>
    typeof n === "string" ? n : (n as { id: string }).id,
}));

vi.mock("@/lib/colors", () => ({
  agentColor: vi.fn(() => "#0f0"),
}));

vi.mock("@/lib/config", () => ({
  GRAPH: {
    particleRadius: 3,
    particleSpeed: 1500,
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { select as realSelect } from "d3-selection";
import { useNodeVisualsEffect } from "../useNodeVisualsEffect";
import type { AgentGraphRefs } from "../refs";
import type { SimNode, SimLink } from "@/lib/d3";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    agentType: "main",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

/**
 * Build an SVG with g.nodes, g.links (with path.main elements bound to links),
 * and g.particles — the minimum structure useNodeVisualsEffect expects.
 *
 * `linkData` maps "sourceId→targetId" to a SimLink-like object.
 */
function buildSvgWithLinks(
  nodeItems: Array<{
    id: string;
    status?: AgentState["status"];
    x?: number;
    y?: number;
  }>,
  linkItems: Array<{
    sourceId: string;
    targetId: string;
    sourceX?: number;
    sourceY?: number;
    targetX?: number;
    targetY?: number;
  }>,
  particleHash = "",
): SVGSVGElement {
  const svgEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
  const root = realSelect(svgEl);

  // g.nodes
  const nodeGroup = root.append("g").attr("class", "nodes");
  for (const item of nodeItems) {
    const gEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    ) as SVGGElement;
    gEl.setAttribute("class", "node");
    const datum: SimNode = {
      id: item.id,
      agent: makeAgent({
        id: item.id,
        status: item.status ?? "running",
      }) as SimNode["agent"],
      x: item.x,
      y: item.y,
    } as SimNode;
    (gEl as unknown as { __data__: SimNode }).__data__ = datum;
    (nodeGroup.node() as SVGGElement).appendChild(gEl);
  }

  // g.links — each link is a path.main element with its datum bound
  const linkGroup = root.append("g").attr("class", "links");
  for (const lk of linkItems) {
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    ) as SVGPathElement;
    pathEl.setAttribute("class", "main");
    const sourceNode: Partial<SimNode> = {
      id: lk.sourceId,
      x: lk.sourceX ?? 0,
      y: lk.sourceY ?? 0,
    };
    const targetNode: Partial<SimNode> = {
      id: lk.targetId,
      x: lk.targetX ?? 100,
      y: lk.targetY ?? 100,
    };
    const datum: SimLink = {
      source: sourceNode as SimNode,
      target: targetNode as SimNode,
      edgeType: "parent",
    };
    (pathEl as unknown as { __data__: SimLink }).__data__ = datum;
    (linkGroup.node() as SVGGElement).appendChild(pathEl);
  }

  // g.particles — initially empty, hook will populate it
  const particleGroup = root.append("g").attr("class", "particles");
  if (particleHash) {
    (particleGroup.node() as SVGGElement).setAttribute(
      "data-hash",
      particleHash,
    );
  }

  return svgEl;
}

function makeRefs(svgEl: SVGSVGElement | null): AgentGraphRefs {
  return {
    svgRef: makeRef(svgEl),
    containerRef: makeRef(null),
    simulationRef: makeRef(null),
    nodesRef: makeRef([]),
    linksRef: makeRef([]),
    toolNodesRef: makeRef([]),
    toolLinksRef: makeRef([]),
    zoomRef: makeRef(null),
    effectsRef: makeRef([]),
    prevActivityLenRef: makeRef(0),
  };
}

function defaultOpts(agents: Map<string, AgentState>) {
  return {
    agents,
    selectedAgentId: null as string | null,
    heatmapEnabled: false,
    heatmapMetric: "idleRatio" as import("@/lib/types").HeatmapMetric,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNodeVisualsEffect — particle emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends circle elements to g.particles for a running target", () => {
    const targetAgent = makeAgent({ id: "b1", status: "running" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "running", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
    );

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    expect(particleGroup).not.toBeNull();
    const circles = particleGroup!.querySelectorAll("circle");
    // 2 particles per active link
    expect(circles.length).toBe(2);
  });

  it("appends circle elements for an idle target (idle is also active)", () => {
    const targetAgent = makeAgent({ id: "b1", status: "idle" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "idle", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
    );

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    expect(circles.length).toBe(2);
  });

  it("each particle circle has an animateMotion child", () => {
    const targetAgent = makeAgent({ id: "b1", status: "running" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "running", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
    );

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    for (const circle of Array.from(circles)) {
      const motions = circle.querySelectorAll("animateMotion");
      expect(motions.length).toBe(1);
    }
  });

  it("each particle circle has an animate (opacity) child", () => {
    const targetAgent = makeAgent({ id: "b1", status: "running" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "running", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
    );

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    for (const circle of Array.from(circles)) {
      const opacityAnims = circle.querySelectorAll(
        "animate[attributeName='opacity']",
      );
      expect(opacityAnims.length).toBe(1);
    }
  });

  it("skips particle emission when target agent status is 'completed'", () => {
    const targetAgent = makeAgent({ id: "b1", status: "completed" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "completed", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
    );

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    expect(circles.length).toBe(0);
  });

  it("skips particle emission when source node has no x/y position", () => {
    const targetAgent = makeAgent({ id: "b1", status: "running" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    // Source node at undefined x/y
    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running" }, // no x/y
        { id: "b1", status: "running", x: 100, y: 100 },
      ],
      [{ sourceId: "a1", targetId: "b1" }], // source x/y defaults to 0 in helper but bind undefined
    );

    // Manually clear source x/y in the link datum
    const linkGroup = svg.querySelector("g.links");
    const pathEl = linkGroup!.querySelector("path.main");
    const datum = (pathEl as unknown as { __data__: SimLink }).__data__;
    (datum.source as SimNode).x = undefined;
    (datum.source as SimNode).y = undefined;

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    // Should not emit particles when coordinates are absent
    expect(circles.length).toBe(0);
  });

  it("skips re-building particles when the particle hash is unchanged", () => {
    const targetAgent = makeAgent({ id: "b1", status: "running" });
    const sourceAgent = makeAgent({ id: "a1", status: "running" });

    // Pre-set the data-hash to the hash that the hook would compute.
    // activeLinkIds will be ["a1→b1"] → sorted → "a1→b1"
    const existingHash = "a1→b1";

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "running", x: 100, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 100,
        },
      ],
      existingHash,
    );

    // Put a sentinel circle in g.particles to verify it is NOT removed
    const particleGroupEl = svg.querySelector("g.particles")!;
    const sentinel = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    sentinel.setAttribute("class", "sentinel");
    particleGroupEl.appendChild(sentinel);

    const agents = new Map([
      ["a1", sourceAgent],
      ["b1", targetAgent],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    // Sentinel should still be present — particles not rebuilt
    const sentinels = particleGroupEl.querySelectorAll("circle.sentinel");
    expect(sentinels.length).toBe(1);
  });

  it("emits 2 particles per active link for multiple active links", () => {
    const agents = new Map([
      ["a1", makeAgent({ id: "a1", status: "running" })],
      ["b1", makeAgent({ id: "b1", status: "running" })],
      ["c1", makeAgent({ id: "c1", status: "idle" })],
    ]);

    const svg = buildSvgWithLinks(
      [
        { id: "a1", status: "running", x: 0, y: 0 },
        { id: "b1", status: "running", x: 100, y: 0 },
        { id: "c1", status: "idle", x: 50, y: 100 },
      ],
      [
        {
          sourceId: "a1",
          targetId: "b1",
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 0,
        },
        {
          sourceId: "a1",
          targetId: "c1",
          sourceX: 0,
          sourceY: 0,
          targetX: 50,
          targetY: 100,
        },
      ],
    );

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    const particleGroup = svg.querySelector("g.particles");
    const circles = particleGroup!.querySelectorAll("circle");
    // 2 links × 2 particles each = 4
    expect(circles.length).toBe(4);
  });
});
