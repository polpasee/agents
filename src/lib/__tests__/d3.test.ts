import { describe, it, expect } from "vitest";
import * as d3 from "d3";
import { renderNodeVisuals, hexPath } from "../d3/renderNode";
import { updateLinkVisuals } from "../d3/updateLinks";
import { GRAPH } from "../config";
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

describe("renderNodeVisuals depth scaling", () => {
  // The first path appended is the opaque backplate hex drawn at the
  // effective node radius, so its `d` pins down the radius exactly.
  function renderHex(agent: AgentState, depth?: number): string {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    renderNodeVisuals(g, agent, null, depth);
    return g.select("path").attr("d");
  }

  it("depth-1 sub-agent hex uses exactly the pre-change radius", () => {
    const agent = createMockAgent({ parentId: "p1" });
    expect(renderHex(agent, 1)).toBe(hexPath(28));
  });

  it("omitted depth renders identically to depth 1", () => {
    const agent = createMockAgent({ parentId: "p1" });
    expect(renderHex(agent)).toBe(renderHex(agent, 1));
  });

  it("depth-2 sub-agent hex shrinks by one depthScale step", () => {
    const agent = createMockAgent({ parentId: "p1" });
    expect(renderHex(agent, 2)).toBe(hexPath(GRAPH.subAgentNodeRadius * GRAPH.depthScale));
  });

  it("main agent radius ignores depth", () => {
    const agent = createMockAgent();
    expect(renderHex(agent, 3)).toBe(hexPath(GRAPH.nodeRadius));
  });

  it("team member (parentId + teamId) stays full-size regardless of depth", () => {
    const agent = createMockAgent({ parentId: "p1", teamId: "t1" });
    expect(renderHex(agent, 2)).toBe(hexPath(GRAPH.nodeRadius));
  });
});

describe("renderNodeVisuals workflow label", () => {
  it("renders the verbatim workflow label as the sub-label", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    // agentType !== "main" makes showName true so the sub-label text is rendered
    const agent = createMockAgent({ agentType: "generic", parentId: "p1", displayType: "workflow-subagent" });

    renderNodeVisuals(g, agent, null, 1, "find:A-line-scan");

    const texts = Array.from(g.node()!.querySelectorAll("text"));
    const found = texts.some((t) => t.textContent === "find:A-line-scan");
    expect(found).toBe(true);
  });

  it("falls back to the type label when no workflow label", () => {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({ agentType: "generic", parentId: "p1", displayType: "workflow-subagent" });

    renderNodeVisuals(g, agent, null, 1);

    const texts = Array.from(g.node()!.querySelectorAll("text"));
    const hasWorkflowLabel = texts.some((t) => t.textContent === "find:A-line-scan");
    expect(hasWorkflowLabel).toBe(false);
    // The type label (uppercased displayType) is rendered as the sub-label
    expect(texts.some((t) => t.textContent === "WORKFLOW-SUBAGENT")).toBe(true);
  });

  it("(a) workflowLabel wins over workflowName when both are set", () => {
    const svg = d3.select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({
      agentType: "generic",
      parentId: "p1",
      displayType: "workflow-subagent",
      workflowName: "code-review-max",
    });

    renderNodeVisuals(g, agent, null, 1, "find:A-line-scan");

    const texts = Array.from(g.node()!.querySelectorAll("text"));
    expect(texts.some((t) => t.textContent === "find:A-line-scan")).toBe(true);
    expect(texts.some((t) => t.textContent === "CODE-REVIEW-MAX")).toBe(false);
  });

  it("(b) workflowName uppercased is rendered when workflowLabel is absent", () => {
    const svg = d3.select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({
      agentType: "generic",
      parentId: "p1",
      displayType: "workflow-subagent",
      workflowName: "code-review-max",
    });

    renderNodeVisuals(g, agent, null, 1);

    const texts = Array.from(g.node()!.querySelectorAll("text"));
    expect(texts.some((t) => t.textContent === "CODE-REVIEW-MAX")).toBe(true);
    expect(texts.some((t) => t.textContent === "WORKFLOW-SUBAGENT")).toBe(false);
  });

  it("(c) typeLabel is rendered when neither workflowLabel nor workflowName is set", () => {
    const svg = d3.select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    const agent = createMockAgent({ agentType: "generic", parentId: "p1", displayType: "workflow-subagent" });

    renderNodeVisuals(g, agent, null, 1);

    const texts = Array.from(g.node()!.querySelectorAll("text"));
    expect(texts.some((t) => t.textContent === "WORKFLOW-SUBAGENT")).toBe(true);
    expect(texts.some((t) => t.textContent === "CODE-REVIEW-MAX")).toBe(false);
  });
});

describe("renderNodeVisuals center model + effort", () => {
  function render(agent: AgentState): SVGTextElement[] {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    renderNodeVisuals(g, agent, null);
    return Array.from(g.node()!.querySelectorAll("text"));
  }

  it("renders FABLE + uppercased effort as two center lines", () => {
    const texts = render(createMockAgent({ model: "claude-fable-5", effort: "high" }));
    expect(texts.some((t) => t.textContent === "FABLE")).toBe(true);
    expect(texts.some((t) => t.textContent === "HIGH")).toBe(true);
  });

  it("renders OPUS + HIGH for an opus model with high effort", () => {
    const texts = render(createMockAgent({ model: "claude-opus-4-8", effort: "high" }));
    expect(texts.some((t) => t.textContent === "OPUS")).toBe(true);
    expect(texts.some((t) => t.textContent === "HIGH")).toBe(true);
  });

  it("renders the effort line smaller and non-bold relative to the model line", () => {
    const texts = render(createMockAgent({ model: "claude-opus-4-8", effort: "high" }));
    const modelNode = texts.find((t) => t.textContent === "OPUS")!;
    const effortNode = texts.find((t) => t.textContent === "HIGH")!;
    expect(modelNode.getAttribute("font-weight")).toBe("bold");
    expect(effortNode.getAttribute("font-weight")).toBe("normal");
    expect(Number(effortNode.getAttribute("font-size"))).toBeLessThan(
      Number(modelNode.getAttribute("font-size")),
    );
  });

  it("renders only the model name when no effort is set", () => {
    const texts = render(createMockAgent({ model: "claude-opus-4-8" }));
    expect(texts.some((t) => t.textContent === "OPUS")).toBe(true);
    // No effort word anywhere (these would only appear if effort were set)
    const effortWords = ["LOW", "MEDIUM", "HIGH", "XHIGH", "MAX", "AUTO"];
    expect(texts.some((t) => effortWords.includes(t.textContent ?? ""))).toBe(false);
  });

  it("renders effort exactly once, in the center, even when the name line shows", () => {
    // agentType !== "main" makes showName true; effort must NOT also appear below the hex.
    const texts = render(
      createMockAgent({ agentType: "generic", parentId: "p1", model: "claude-opus-4-8", effort: "medium" }),
    );
    const effortNodes = texts.filter((t) => t.textContent === "MEDIUM");
    expect(effortNodes.length).toBe(1);
    // Center lines set dominant-baseline="central"; the below-hex labels don't —
    // so this pins the effort to the CENTER (guards de-dup AND relocation).
    expect(effortNodes[0].getAttribute("dominant-baseline")).toBe("central");
  });

  it("renders the type initial + effort when the model family is unknown", () => {
    // model doesn't match the claude-(fable|opus|sonnet|haiku) regex → modelName is null,
    // so line 1 falls back to typeLabel.charAt(0) ("A" — AGENT_LABELS["generic"] is "AGENT")
    // and line 2 is the effort.
    const texts = render(
      createMockAgent({ agentType: "generic", parentId: "p1", model: "gpt-4", effort: "high" }),
    );
    expect(texts.some((t) => t.textContent === "A")).toBe(true);
    const effortNode = texts.find((t) => t.textContent === "HIGH");
    expect(effortNode).toBeDefined();
    // dominant-baseline="central" is unique to the center lines → pins line 2 to the center.
    expect(effortNode!.getAttribute("dominant-baseline")).toBe("central");
  });

  it("sources the center effort line from metadata.effort when effort is unset", () => {
    const texts = render(createMockAgent({ model: "claude-opus-4-8", metadata: { effort: "max" } }));
    expect(texts.some((t) => t.textContent === "OPUS")).toBe(true);
    expect(texts.some((t) => t.textContent === "MAX")).toBe(true);
  });
});

describe("renderNodeVisuals main-agent repo label", () => {
  function render(agent: AgentState): SVGTextElement[] {
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const g = svg.append("g") as d3.Selection<SVGGElement, any, any, any>;
    renderNodeVisuals(g, agent, null);
    return Array.from(g.node()!.querySelectorAll("text"));
  }

  it("renders the repo (last path segment of projectName) below the main hexagon", () => {
    const texts = render(
      createMockAgent({ agentType: "main", metadata: { projectName: "Users/erdos/Github/agents" } }),
    );
    const repoNode = texts.find((t) => t.textContent === "AGENTS");
    expect(repoNode).toBeDefined();
    // Below-hex label: positioned at labelY with letter-spacing, NOT a center line.
    expect(repoNode!.getAttribute("dominant-baseline")).toBeNull();
    expect(repoNode!.getAttribute("letter-spacing")).toBe("2px");
  });

  it("does not render a repo label for sub-agents", () => {
    const texts = render(
      createMockAgent({
        agentType: "generic",
        parentId: "p1",
        metadata: { projectName: "Users/erdos/Github/agents" },
      }),
    );
    expect(texts.some((t) => t.textContent === "AGENTS")).toBe(false);
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
