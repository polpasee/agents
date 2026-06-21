/**
 * d3/heatmap.ts — branch coverage for uncovered regions (lines 46, 72, 105, 164-242).
 *
 * Covers:
 *  Branch 3:  idleRatio — elapsed <= 0 guard (returns 0.5)
 *  Branch 5:  idleRatio — gap < 5000 branch (busyTime not accumulated for large gaps)
 *  Branch 8:  avgToolLatency with exactly 1 tool call (< 2 → returns 0.5)
 *  Branch 9:  renderHeatmapNode — isSelected = true (glow ring appended)
 *  Branch 10: AGENT_LABELS[agentType]?.[0] fallback ("?" when label absent)
 *  Branch 11: AGENT_LABELS[agentType] fallback ("AGENT" for undefined type)
 *  Branch 12: renderHeatmapLegend — svg.select("defs").empty() true vs false
 *  Branch 13: labels[metric] || metric fallback
 *  Lines 164-242: renderHeatmapLegend full body execution for all metrics
 */
import { describe, it, expect } from "vitest";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import type { AgentState, HeatmapMetric } from "../types";
import {
  computeMetricValue,
  precomputeHeatmapNorms,
  renderHeatmapNode,
  renderHeatmapLegend,
  createHeatmapScale,
} from "../d3/heatmap";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "a1",
    agentType: "build",
    status: "running",
    task: "test",
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: 0,
    ...overrides,
  };
}

function makeSvgG(): Selection<SVGGElement, unknown, null, undefined> {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  return select(svg).append("g") as unknown as Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  >;
}

function makeSvgEl(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

// ── computeMetricValue — idleRatio branches ───────────────────────────────────

describe("computeMetricValue — idleRatio edge cases", () => {
  it("returns 0.5 when elapsed <= 0 (branch 3: no duration yet)", () => {
    const agent = makeAgent({
      startTime: Date.now() + 5000, // future start → elapsed < 0
      duration: 0, // explicitly zero
      toolCalls: [{ tool: "bash", timestamp: Date.now() }],
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "idleRatio", norms);
    expect(value).toBe(0.5);
  });

  it("returns 0.5 when toolCalls is empty regardless of elapsed (branch 3 second condition)", () => {
    const agent = makeAgent({
      startTime: Date.now() - 10000, // 10s elapsed
      toolCalls: [], // empty
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "idleRatio", norms);
    expect(value).toBe(0.5);
  });

  it("excludes gaps >= 5000ms from busyTime (branch 5: gap NOT < 5000)", () => {
    // Two tool calls with 8s gap — excluded from busyTime → high idle ratio
    const agent = makeAgent({
      startTime: 0,
      duration: 20000,
      toolCalls: [
        { tool: "read", timestamp: 1000 },
        { tool: "bash", timestamp: 9000 }, // gap = 8000ms > 5000ms → NOT busyTime
      ],
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "idleRatio", norms);
    // busyTime = 0 → idleRatio = 1 - 0/20000 = 1.0
    expect(value).toBeCloseTo(1.0);
  });

  it("includes gaps < 5000ms in busyTime (branch 5: gap < 5000)", () => {
    // Two tool calls with 2s gap — included in busyTime → lower idle ratio
    const agent = makeAgent({
      startTime: 0,
      duration: 10000,
      toolCalls: [
        { tool: "read", timestamp: 1000 },
        { tool: "bash", timestamp: 3000 }, // gap = 2000ms < 5000ms → busyTime
      ],
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "idleRatio", norms);
    // busyTime = 2000, elapsed = 10000, idleRatio = 1 - 2000/10000 = 0.8
    expect(value).toBeCloseTo(0.8);
  });
});

// ── computeMetricValue — avgToolLatency with 1 tool call ─────────────────────

describe("computeMetricValue — avgToolLatency edge cases", () => {
  it("returns 0.5 when agent has exactly 1 tool call (< 2 guard, branch 8)", () => {
    const agent = makeAgent({
      toolCalls: [{ tool: "bash", timestamp: 1000 }],
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "avgToolLatency", norms);
    expect(value).toBe(0.5);
  });

  it("returns 0.5 when agent has 0 tool calls (< 2 guard)", () => {
    const agent = makeAgent({ toolCalls: [] });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "avgToolLatency", norms);
    expect(value).toBe(0.5);
  });

  it("computes avgToolLatency with >= 2 tool calls (normal path)", () => {
    const agent = makeAgent({
      toolCalls: [
        { tool: "read", timestamp: 0 },
        { tool: "bash", timestamp: 15000 }, // 15s gap → 0.5 ratio
      ],
    });
    const norms = precomputeHeatmapNorms([agent]);
    const value = computeMetricValue(agent, "avgToolLatency", norms);
    expect(value).toBeCloseTo(0.5); // avgGap=15000/30000=0.5
  });
});

// ── renderHeatmapNode — isSelected branch ────────────────────────────────────

describe("renderHeatmapNode — isSelected branch (branch 9)", () => {
  it("appends a glow ring when isSelected=true", () => {
    const agent = makeAgent({ agentType: "build" });
    const g = makeSvgG();
    const scale = createHeatmapScale();

    renderHeatmapNode(g, agent, 0.5, scale, true, undefined);

    // With isSelected=true, first child is the glow circle, then the main circle
    const circles = (g.node() as SVGGElement).querySelectorAll("circle");
    // glow ring + main circle = 2 circles
    expect(circles).toHaveLength(2);

    // First circle is the glow ring (has opacity and filter attributes)
    const glowRing = circles[0]!;
    expect(glowRing.getAttribute("opacity")).toBe("0.5");
    expect(glowRing.getAttribute("fill")).toBe("none");
  });

  it("does NOT append a glow ring when isSelected=false", () => {
    const agent = makeAgent({ agentType: "build" });
    const g = makeSvgG();
    const scale = createHeatmapScale();

    renderHeatmapNode(g, agent, 0.5, scale, false, undefined);

    const circles = (g.node() as SVGGElement).querySelectorAll("circle");
    // Only main circle, no glow ring
    expect(circles).toHaveLength(1);
  });
});

// ── renderHeatmapNode — AGENT_LABELS fallback branches ───────────────────────

describe("renderHeatmapNode — agent type label branches (branches 10, 11)", () => {
  it("uses first char of AGENT_LABELS for known agent types (non-fallback)", () => {
    const agent = makeAgent({ agentType: "main" });
    const g = makeSvgG();
    renderHeatmapNode(g, agent, 0.3, createHeatmapScale(), false);

    const texts = (g.node() as SVGGElement).querySelectorAll("text");
    // First text is the type label icon (first char of AGENT_LABELS["main"] = "M")
    expect(texts[0]?.textContent).toBe("M");
    // Second text shows the full label
    expect(texts[1]?.textContent).toBe("MAIN");
  });

  it("falls back to '?' for the icon when agentType has no label", () => {
    // Cast an unknown type through the function to exercise the ?.[0] || "?" branch
    const agent = makeAgent({
      agentType: "unknown-type" as AgentState["agentType"],
    });
    const g = makeSvgG();
    renderHeatmapNode(g, agent, 0.5, createHeatmapScale(), false);

    const texts = (g.node() as SVGGElement).querySelectorAll("text");
    expect(texts[0]?.textContent).toBe("?");
  });

  it("falls back to 'AGENT' label text for unknown agentType (branch 11)", () => {
    const agent = makeAgent({
      agentType: "unknown-type" as AgentState["agentType"],
    });
    const g = makeSvgG();
    renderHeatmapNode(g, agent, 0.5, createHeatmapScale(), false);

    const texts = (g.node() as SVGGElement).querySelectorAll("text");
    expect(texts[1]?.textContent).toBe("AGENT");
  });
});

// ── renderHeatmapLegend — full body execution + branch coverage ───────────────

describe("renderHeatmapLegend — full execution (lines 164-242)", () => {
  const metrics: HeatmapMetric[] = [
    "idleRatio",
    "tokenEfficiency",
    "timeToFirstTool",
    "avgToolLatency",
  ];

  metrics.forEach((metric) => {
    it(`renders legend for metric "${metric}" without error`, () => {
      const svg = select(makeSvgEl()) as Selection<
        SVGSVGElement,
        unknown,
        null,
        undefined
      >;

      expect(() => renderHeatmapLegend(svg, metric, 10, 20)).not.toThrow();

      // Legend group was appended
      expect(svg.select("#heatmap-legend").empty()).toBe(false);

      // Gradient definition was created
      expect(svg.select("#heatmap-grad").empty()).toBe(false);

      // Gradient bar rect exists
      const rects = (svg.node() as SVGSVGElement).querySelectorAll(
        "#heatmap-legend rect",
      );
      expect(rects.length).toBeGreaterThanOrEqual(2); // background + bar
    });
  });

  it("removes and recreates legend group on second call (idempotent)", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;

    renderHeatmapLegend(svg, "idleRatio", 10, 20);
    renderHeatmapLegend(svg, "tokenEfficiency", 10, 20);

    // Only one legend group should exist
    const legends = (svg.node() as SVGSVGElement).querySelectorAll(
      "#heatmap-legend",
    );
    expect(legends).toHaveLength(1);
  });

  it("reuses existing <defs> element when it already exists (branch 12 false)", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;
    // Pre-create a <defs> element so svg.select("defs").empty() === false
    svg.append("defs");

    expect(() => renderHeatmapLegend(svg, "idleRatio", 10, 20)).not.toThrow();

    // Gradient should still be created inside the existing defs
    const defsEls = (svg.node() as SVGSVGElement).querySelectorAll("defs");
    expect(defsEls).toHaveLength(1); // not duplicated
    expect(svg.select("#heatmap-grad").empty()).toBe(false);
  });

  it("creates <defs> element when none exists (branch 12 true)", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;
    // No pre-existing defs → svg.select("defs").empty() === true → appends defs

    expect(() =>
      renderHeatmapLegend(svg, "avgToolLatency", 5, 5),
    ).not.toThrow();

    const defsEl = (svg.node() as SVGSVGElement).querySelector("defs");
    expect(defsEl).not.toBeNull();
  });

  it("uses metric key as label fallback when metric is not in labels map (branch 13)", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;
    // Pass an unknown metric to hit the `|| metric` fallback branch
    const unknownMetric = "unknownMetric" as HeatmapMetric;

    expect(() => renderHeatmapLegend(svg, unknownMetric, 0, 0)).not.toThrow();

    // The text element for the metric label should contain the fallback
    const texts = (svg.node() as SVGSVGElement).querySelectorAll(
      "#heatmap-legend text",
    );
    const labelText = Array.from(texts).find(
      (t) => t.textContent === "unknownMetric",
    );
    expect(labelText).not.toBeUndefined();
  });

  it("renders 'Healthy' and 'Bottleneck' min/max labels", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;

    renderHeatmapLegend(svg, "idleRatio", 0, 0);

    const allText = Array.from(
      (svg.node() as SVGSVGElement).querySelectorAll("#heatmap-legend text"),
    ).map((t) => t.textContent);

    expect(allText).toContain("Healthy");
    expect(allText).toContain("Bottleneck");
  });

  it("positions legend group at given (x, y) coordinates", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;

    renderHeatmapLegend(svg, "idleRatio", 42, 99);

    const legendG = (svg.node() as SVGSVGElement).querySelector(
      "#heatmap-legend",
    );
    expect(legendG?.getAttribute("transform")).toBe("translate(42, 99)");
  });

  it("gradient has 3 stop elements with correct offsets", () => {
    const svg = select(makeSvgEl()) as Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;

    renderHeatmapLegend(svg, "idleRatio", 0, 0);

    const stops = (svg.node() as SVGSVGElement).querySelectorAll(
      "#heatmap-grad stop",
    );
    expect(stops).toHaveLength(3);
    expect(stops[0]?.getAttribute("offset")).toBe("0%");
    expect(stops[1]?.getAttribute("offset")).toBe("50%");
    expect(stops[2]?.getAttribute("offset")).toBe("100%");
  });
});
