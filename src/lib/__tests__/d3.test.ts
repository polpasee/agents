import { describe, it, expect } from "vitest";
import * as d3 from "d3";
import { renderNodeVisuals } from "../d3/renderNode";
import { updateLinkVisuals } from "../d3/updateLinks";
import type { AgentState } from "../types";
import type { SimLink } from "../d3/updateLinks";

function createMockAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: "agent-1",
    agentType: "main",
    status: "running",
    task: "test task",
    toolCalls: [],
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 200000,
    startTime: Date.now(),
    ...overrides,
  };
}

describe("renderNodeVisuals", () => {
  it("is exported as a function", () => {
    expect(typeof renderNodeVisuals).toBe("function");
  });

  it("can be called with a mock SVG group without throwing", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent();

    expect(() => renderNodeVisuals(g, agent, null)).not.toThrow();
  });

  it("appends child elements to the group", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent();

    renderNodeVisuals(g, agent, null);

    const children = g.node()!.children;
    expect(children.length).toBeGreaterThan(0);
  });

  it("renders selected state without throwing", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({ id: "selected-1" });

    expect(() => renderNodeVisuals(g, agent, "selected-1")).not.toThrow();
  });

  it("renders completed agent without throwing", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({ status: "completed" });

    expect(() => renderNodeVisuals(g, agent, null)).not.toThrow();
  });
});

describe("updateLinkVisuals", () => {
  it("is exported as a function", () => {
    expect(typeof updateLinkVisuals).toBe("function");
  });

  it("can be called with empty selections without throwing", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g");

    // Create empty selections of SVGLineElement bound to SimLink data
    const linkGlow = g
      .selectAll<SVGLineElement, SimLink>("line.glow")
      .data([] as SimLink[]);
    const linkLine = g
      .selectAll<SVGLineElement, SimLink>("line.link")
      .data([] as SimLink[]);

    const agents = new Map<string, AgentState>();

    expect(() => updateLinkVisuals(linkGlow, linkLine, agents)).not.toThrow();
  });

  it("can process links with agent data without throwing", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, unknown, null, undefined>;

    const links: SimLink[] = [
      { source: "a", target: "b", edgeType: "parent" },
    ];

    // Append actual line elements with bound data
    const glowSel = g
      .selectAll<SVGLineElement, SimLink>("line.glow")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "glow");

    const lineSel = g
      .selectAll<SVGLineElement, SimLink>("line.link")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link");

    const agents = new Map<string, AgentState>();
    agents.set("b", createMockAgent({ id: "b" }));

    expect(() => updateLinkVisuals(glowSel, lineSel, agents)).not.toThrow();
  });
});
