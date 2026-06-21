/**
 * useLayoutModeEffect — attribute accessor branches (lines 61, 67, 70, 64-71).
 *
 * Uses real d3-selection (NOT mocked) so the attr accessor callbacks actually
 * execute, covering:
 *  - Branch 5/6: translate(d.fx ?? d.x ?? 0, d.fy ?? d.y ?? 0) — each
 *    null-coalesce alternative (fx present, fx null + x present, both null)
 *  - Branch 7: linkGroup.empty() === false (links group exists → enters block)
 *  - Branch 8: d.pathD ?? "" fallback in path.main attr
 *
 * Layouts are still mocked so no real positioning happens.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { select } from "d3-selection";
import type { SimNode, SimLink } from "@/lib/d3";
import type { AgentGraphRefs } from "../refs";

// Mock only the layout functions and linkPath — NOT d3-selection.
vi.mock("@/lib/d3/layouts", () => ({
  applyTreeLayout: vi.fn(),
  applyRadialLayout: vi.fn(),
  applyHierarchicalLayout: vi.fn(),
}));

vi.mock("@/lib/d3", () => ({
  linkPath: vi.fn(() => "M0,0L10,10"),
}));

import { useLayoutModeEffect } from "../useLayoutModeEffect";
import { linkPath } from "@/lib/d3";
import {
  applyTreeLayout,
  applyRadialLayout,
  applyHierarchicalLayout,
} from "@/lib/d3/layouts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRef<T>(val: T): React.MutableRefObject<T> {
  return { current: val };
}

function makeSvg(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

function makeContainer(w = 800, h = 600): HTMLDivElement {
  const div = document.createElement("div");
  div.getBoundingClientRect = vi.fn().mockReturnValue({ width: w, height: h });
  return div;
}

function makeMockSim() {
  return {
    alpha: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
    stop: vi.fn(),
  };
}

function makeNode(id: string, opts: Partial<SimNode> = {}): SimNode {
  return {
    id,
    agent: { id } as SimNode["agent"],
    x: undefined,
    y: undefined,
    fx: null,
    fy: null,
    ...opts,
  } as SimNode;
}

/**
 * Build an SVG with real g.node elements bound to SimNode data, and
 * optionally a g.links group with path.glow and path.main elements.
 */
function buildSvg(
  nodes: SimNode[],
  links: SimLink[] = [],
  includeLinks = true,
): SVGSVGElement {
  const svg = makeSvg();
  const d3svg = select(svg);

  // Append g.node elements with data bound
  nodes.forEach((n) => {
    // d3.select.data with individual elements
    d3svg.append("g").attr("class", "node").datum(n);
  });

  if (includeLinks) {
    const linkGroup = d3svg.append("g").attr("class", "links");
    links.forEach((lk) => {
      linkGroup.append("path").attr("class", "glow").datum(lk);
      linkGroup.append("path").attr("class", "main").datum(lk);
    });
  }

  return svg;
}

function makeRefs(svg: SVGSVGElement, nodes: SimNode[]): AgentGraphRefs {
  return {
    svgRef: makeRef(svg),
    containerRef: makeRef(makeContainer()),
    simulationRef: makeRef(
      makeMockSim() as unknown as import("d3-force").Simulation<
        SimNode,
        SimLink
      >,
    ),
    nodesRef: makeRef(nodes),
    linksRef: makeRef<SimLink[]>([]),
    toolNodesRef: makeRef<SimNode[]>([]),
    toolLinksRef: makeRef<SimLink[]>([]),
    zoomRef: makeRef(null),
    effectsRef: makeRef([]),
    prevActivityLenRef: makeRef(0),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useLayoutModeEffect — attr accessor branches (real d3-selection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyTreeLayout).mockImplementation((nodes) => {
      // Assign fx/fy so the transform callback has something to read
      nodes.forEach((n, i) => {
        n.fx = i * 100;
        n.fy = i * 50;
      });
    });
    vi.mocked(applyRadialLayout).mockImplementation((nodes) => {
      nodes.forEach((n, i) => {
        n.fx = i * 80;
        n.fy = i * 80;
      });
    });
    vi.mocked(applyHierarchicalLayout).mockImplementation((nodes) => {
      nodes.forEach((n) => {
        n.x = 200;
        n.y = 150;
        // fx/fy stay null → fallback to x/y
      });
    });
  });

  it("transform accessor reads fx/fy when both are set (non-null branch)", () => {
    const node = makeNode("n1");
    const svg = buildSvg([node], [], false);
    const refs = makeRefs(svg, [node]);

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "tree", topologyVersion: 1 }),
    );

    // applyTreeLayout sets fx=0, fy=0 for first node
    const gEl = svg.querySelector("g.node");
    expect(gEl?.getAttribute("transform")).toBe("translate(0, 0)");
  });

  it("transform accessor falls back to x when fx is null", () => {
    const node = makeNode("n1", { x: 77, y: 99, fx: null, fy: null });
    // hierarchical mock leaves fx/fy null, sets x/y
    const svg = buildSvg([node], [], false);
    const refs = makeRefs(svg, [node]);

    vi.mocked(applyHierarchicalLayout).mockImplementation((nodes) => {
      nodes.forEach((n) => {
        n.fx = null;
        n.fy = null;
        n.x = 77;
        n.y = 99;
      });
    });

    renderHook(() =>
      useLayoutModeEffect(refs, {
        graphLayout: "hierarchical",
        topologyVersion: 1,
      }),
    );

    const gEl = svg.querySelector("g.node");
    // fx is null → falls through to x=77
    expect(gEl?.getAttribute("transform")).toBe("translate(77, 99)");
  });

  it("transform accessor falls back to 0 when both fx and x are null/undefined", () => {
    const node = makeNode("n1", {
      x: undefined,
      y: undefined,
      fx: null,
      fy: null,
    });
    const svg = buildSvg([node], [], false);
    const refs = makeRefs(svg, [node]);

    // applyRadialLayout mock sets fx/fy, so override to leave them null
    vi.mocked(applyRadialLayout).mockImplementation((nodes) => {
      nodes.forEach((n) => {
        n.fx = null;
        n.fy = null;
        // x/y left as undefined
      });
    });

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "radial", topologyVersion: 1 }),
    );

    const gEl = svg.querySelector("g.node");
    // Both null/undefined → final fallback to 0
    expect(gEl?.getAttribute("transform")).toBe("translate(0, 0)");
  });

  it("enters linkGroup block and calls linkPath for glow paths when g.links exists", () => {
    const node = makeNode("n1", { fx: 10, fy: 20 });
    const link: SimLink = {
      source: "n1",
      target: "n2",
      edgeType: "parent",
    };
    const svg = buildSvg([node], [link], true); // includes g.links
    const refs = makeRefs(svg, [node]);

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "tree", topologyVersion: 1 }),
    );

    // linkPath is called by the glow attr accessor
    expect(vi.mocked(linkPath)).toHaveBeenCalled();
  });

  it("path.main attr uses pathD set by glow (non-null branch)", () => {
    const node = makeNode("n1", { fx: 10, fy: 20 });
    const link: SimLink = {
      source: "n1",
      target: "n2",
      edgeType: "parent",
      pathD: "M10,20L30,40",
    } as SimLink & { pathD?: string };
    const svg = buildSvg([node], [link], true);
    const refs = makeRefs(svg, [node]);

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "tree", topologyVersion: 1 }),
    );

    // The path.main element should have d attribute set
    const mainPath = svg.querySelector("path.main");
    // After glow runs, pathD is updated then main reads it
    expect(mainPath?.getAttribute("d")).toBeTruthy();
  });

  it("path.main attr falls back to empty string when pathD is absent", () => {
    const node = makeNode("n1", { fx: 10, fy: 20 });
    const link: SimLink = {
      source: "n1",
      target: "n2",
      edgeType: "parent",
      // no pathD property
    } as SimLink;

    // Override linkPath to return something so glow sets pathD
    vi.mocked(linkPath).mockReturnValue("");

    const svg = buildSvg([node], [link], true);
    const refs = makeRefs(svg, [node]);

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "tree", topologyVersion: 1 }),
    );

    const mainPath = svg.querySelector("path.main");
    // pathD was set to "" by glow → main reads "" (empty string is falsy but defined)
    expect(mainPath?.getAttribute("d")).toBe("");
  });

  it("skips linkGroup block when g.links is not in SVG (empty() === true branch)", () => {
    const node = makeNode("n1", { fx: 10, fy: 20 });
    // Build SVG without links group
    const svg = buildSvg([node], [], false);
    const refs = makeRefs(svg, [node]);

    renderHook(() =>
      useLayoutModeEffect(refs, { graphLayout: "tree", topologyVersion: 1 }),
    );

    // linkPath should NOT be called because linkGroup is empty
    expect(vi.mocked(linkPath)).not.toHaveBeenCalled();
  });
});
