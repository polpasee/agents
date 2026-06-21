import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState } from "@/lib/types";

// Mock the heavier rendering helpers so the test focuses on the hash
// short-circuit logic, not the internal DOM shape of each renderer.
// d3-selection is NOT mocked — the hook uses real d3 select/selectAll/each
// so we build a real SVG tree in jsdom.
vi.mock("@/lib/d3", () => ({
  renderNodeVisuals: vi.fn(),
  updateLinkVisuals: vi.fn(),
  bezierPath: vi.fn(() => "M0,0"),
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

import { select as realSelect } from "d3-selection";
import { useNodeVisualsEffect } from "../useNodeVisualsEffect";
import { renderNodeVisuals, updateLinkVisuals } from "@/lib/d3";
import type { AgentGraphRefs } from "../refs";
import type { SimNode } from "@/lib/d3";

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
 * Build a real SVG element in jsdom with a g.nodes group.
 * Each nodeItem becomes a g.node child whose __data__ is set so d3's
 * .each() provides `d.id`.
 */
function buildSvg(
  nodeItems: Array<{ id: string; hash?: string }>,
): SVGSVGElement {
  const svgEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
  const root = realSelect(svgEl);
  root.append("g").attr("class", "nodes");
  root.append("g").attr("class", "links");
  root.append("g").attr("class", "particles");

  const nodeGroup = root.select("g.nodes");
  for (const item of nodeItems) {
    const gEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    ) as SVGGElement;
    gEl.setAttribute("class", "node");
    if (item.hash) gEl.setAttribute("data-hash", item.hash);
    // Bind datum so the hook's .each(function(d) { ... d.id ... }) works
    const datum: SimNode = {
      id: item.id,
      agent: makeAgent({ id: item.id }) as SimNode["agent"],
    } as SimNode;
    (gEl as unknown as { __data__: SimNode }).__data__ = datum;
    (nodeGroup.node() as SVGGElement).appendChild(gEl);
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

/** Compute the hash the hook will produce for a given agent/options combo */
function expectedHash(
  agent: AgentState,
  selectedAgentId: string | null = null,
  heatmapEnabled = false,
  heatmapMetric: import("@/lib/types").HeatmapMetric = "idleRatio",
): string {
  const lastTool =
    agent.toolCalls.length > 0
      ? agent.toolCalls[agent.toolCalls.length - 1]!.tool
      : "";
  return `${agent.status}|${agent.agentType}|${lastTool}|${agent.toolCalls.length}|${agent.inputTokens + agent.outputTokens}|${agent.id === selectedAgentId}|${heatmapEnabled}|${heatmapMetric}`;
}

describe("useNodeVisualsEffect — hash short-circuit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls renderNodeVisuals on first render (no previous hash)", () => {
    const agent = makeAgent({ id: "n1", status: "running" });
    const svg = buildSvg([{ id: "n1" }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).toHaveBeenCalled();
  });

  it("skips renderNodeVisuals when the hash is unchanged", () => {
    const agent = makeAgent({ id: "n1", status: "running" });
    const hash = expectedHash(agent);
    const svg = buildSvg([{ id: "n1", hash }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).not.toHaveBeenCalled();
  });

  it("re-renders when status changes (hash mismatch)", () => {
    const agent = makeAgent({ id: "n1", status: "completed" });
    // Stale hash: status was "running"
    const staleHash = expectedHash({ ...agent, status: "running" });
    const svg = buildSvg([{ id: "n1", hash: staleHash }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).toHaveBeenCalled();
  });

  it("re-renders when agentType changes (hash mismatch)", () => {
    const agent = makeAgent({
      id: "n1",
      agentType: "generic",
      status: "running",
    });
    const staleHash = expectedHash({ ...agent, agentType: "main" });
    const svg = buildSvg([{ id: "n1", hash: staleHash }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).toHaveBeenCalled();
  });

  it("re-renders when selectedAgentId changes (hash mismatch)", () => {
    const agent = makeAgent({ id: "n1", status: "running" });
    // Stale hash computed without selection
    const staleHash = expectedHash(agent, null);
    const svg = buildSvg([{ id: "n1", hash: staleHash }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() =>
      useNodeVisualsEffect(makeRefs(svg), {
        ...defaultOpts(agents),
        selectedAgentId: "n1",
      }),
    );

    expect(renderNodeVisuals).toHaveBeenCalled();
  });

  it("re-renders when token count increases (hash mismatch)", () => {
    const agent = makeAgent({
      id: "n1",
      status: "running",
      inputTokens: 500,
      outputTokens: 250,
    });
    // Stale hash with 0 tokens
    const staleHash = expectedHash({
      ...agent,
      inputTokens: 0,
      outputTokens: 0,
    });
    const svg = buildSvg([{ id: "n1", hash: staleHash }]);
    const agents = new Map([["n1", agent]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).toHaveBeenCalled();
  });

  it("renders only changed nodes when multiple nodes are present", () => {
    const agentA = makeAgent({ id: "n1", status: "running" });
    const agentB = makeAgent({ id: "n2", status: "completed" });
    // n1 has a current hash → skipped; n2 has a stale hash → re-rendered
    const currentHashN1 = expectedHash(agentA);
    const staleHashN2 = expectedHash({ ...agentB, status: "running" });

    const svg = buildSvg([
      { id: "n1", hash: currentHashN1 },
      { id: "n2", hash: staleHashN2 },
    ]);
    const agents = new Map([
      ["n1", agentA],
      ["n2", agentB],
    ]);

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).toHaveBeenCalledTimes(1);
  });

  it("skips nodes whose id is absent from the agents map", () => {
    const svg = buildSvg([{ id: "ghost" }]);
    const agents = new Map<string, AgentState>();

    renderHook(() => useNodeVisualsEffect(makeRefs(svg), defaultOpts(agents)));

    expect(renderNodeVisuals).not.toHaveBeenCalled();
  });

  it("calls updateLinkVisuals with the agents map", () => {
    const svgEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    const root = realSelect(svgEl);
    root.append("g").attr("class", "nodes");
    root.append("g").attr("class", "links");
    root.append("g").attr("class", "particles");

    const agent = makeAgent({ id: "n1" });
    const agents = new Map([["n1", agent]]);

    renderHook(() =>
      useNodeVisualsEffect(makeRefs(svgEl), defaultOpts(agents)),
    );

    expect(updateLinkVisuals).toHaveBeenCalled();
  });

  it("does nothing when svgRef is null", () => {
    const agents = new Map([["n1", makeAgent({ id: "n1" })]]);

    renderHook(() => useNodeVisualsEffect(makeRefs(null), defaultOpts(agents)));

    expect(renderNodeVisuals).not.toHaveBeenCalled();
    expect(updateLinkVisuals).not.toHaveBeenCalled();
  });
});
