import { describe, it, expect } from "vitest";
import { select } from "d3-selection";
import { updateLinkVisuals, linkPath, bezierPath } from "../d3/updateLinks";
import type { SimLink, SimNode } from "../d3/updateLinks";
import { UI, agentColor } from "../colors";
import type { AgentState } from "../types";

function agent(id: string, status: AgentState["status"]): AgentState {
  return {
    id,
    agentType: "build",
    status,
    task: "",
    startTime: 0,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    contextWindow: 1_000_000,
  } as AgentState;
}

/** Bind links to <line> elements in a real (jsdom) SVG and run the visuals pass. */
function render(links: SimLink[], agents: Map<string, AgentState>) {
  const svg = select(
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  );
  const glowG = svg.append("g");
  const lineG = svg.append("g");
  const linkGlow = glowG
    .selectAll<SVGLineElement, SimLink>("line")
    .data(links)
    .join("line");
  const linkLine = lineG
    .selectAll<SVGLineElement, SimLink>("line")
    .data(links)
    .join("line");
  updateLinkVisuals(linkGlow, linkLine, agents);
  return { lines: linkLine.nodes(), glows: linkGlow.nodes() };
}

describe("updateLinkVisuals", () => {
  const agents = new Map<string, AgentState>([
    ["run", agent("run", "running")],
    ["idle", agent("idle", "idle")],
    ["done", agent("done", "completed")],
  ]);
  const links: SimLink[] = [
    { source: "a", target: "msg", edgeType: "message" },
    { source: "a", target: "run", edgeType: "parent" },
    { source: "a", target: "idle", edgeType: "parent" },
    { source: "a", target: "done", edgeType: "parent" },
    { source: "a", target: "missing", edgeType: "blocking" },
  ];
  const { lines, glows } = render(links, agents);
  const msg = lines[0]!;
  const run = lines[1]!;
  const idle = lines[2]!;
  const done = lines[3]!;
  const missing = lines[4]!;
  const runGlow = glows[1]!;
  const doneGlow = glows[3]!;
  const missingGlow = glows[4]!;

  it("renders message edges amber, dotted, half-opacity, no animation", () => {
    expect(msg.getAttribute("stroke")).toBe(UI.tool);
    expect(msg.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(msg.getAttribute("stroke-opacity")).toBe("0.5");
    expect(msg.querySelector("animate")).toBeNull();
  });

  it("colors a parent edge by its target agent and animates a running child", () => {
    expect(run.getAttribute("stroke")).toBe(agentColor(agents.get("run")!));
    expect(run.getAttribute("stroke-dasharray")).toBe("8 4");
    expect(run.querySelector("animate")).not.toBeNull();
    expect(run.querySelector("animate")!.getAttribute("attributeName")).toBe(
      "stroke-dashoffset",
    );
  });

  it("dashes idle children but does not animate them", () => {
    expect(idle.getAttribute("stroke-dasharray")).toBe("8 4");
    expect(idle.querySelector("animate")).toBeNull();
  });

  it("fades completed/error edges and leaves them solid", () => {
    expect(done.getAttribute("stroke-dasharray")).toBe("none");
    expect(done.getAttribute("stroke-opacity")).toBe("0.2");
    expect(done.querySelector("animate")).toBeNull();
  });

  it("falls back to secondary color when the target agent is unknown", () => {
    expect(missing.getAttribute("stroke")).toBe(UI.text.secondary);
    expect(missing.getAttribute("stroke-opacity")).toBe("0.6");
  });

  it("renders the glow layer with reduced opacity per state", () => {
    expect(runGlow.getAttribute("stroke-opacity")).toBe("0.1");
    expect(doneGlow.getAttribute("stroke-opacity")).toBe("0.03");
    expect(missingGlow.getAttribute("stroke")).toBe(UI.text.secondary);
  });

  it("removes stale animate children on re-render (running -> completed)", () => {
    const map = new Map([["run", agent("run", "completed")]]);
    const { lines: l2 } = render(
      [{ source: "a", target: "run", edgeType: "parent" }],
      map,
    );
    expect(l2[0]!.querySelector("animate")).toBeNull();
    expect(l2[0]!.getAttribute("stroke-opacity")).toBe("0.2");
  });
});

describe("linkPath / bezierPath", () => {
  it("draws a straight line between two points", () => {
    expect(bezierPath(0, 0, 10, 20)).toBe("M0,0 L10,20");
  });

  it("prefers fx/fy, falls back to x/y then 0", () => {
    const link = {
      source: { fx: 1, fy: 2 } as SimNode,
      target: { x: 3, y: 4 } as SimNode,
      edgeType: "parent",
    } as SimLink;
    expect(linkPath(link)).toBe("M1,2 L3,4");
    const zero = {
      source: {} as SimNode,
      target: {} as SimNode,
    } as SimLink;
    expect(linkPath(zero)).toBe("M0,0 L0,0");
  });
});
