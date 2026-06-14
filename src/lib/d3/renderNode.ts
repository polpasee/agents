import type { Selection } from "d3-selection";
import { AGENT_LABELS, agentColor } from "@/lib/colors";
import { GRAPH, getNodeRadius } from "@/lib/config";
import { depthFactor } from "./depth";
import type { AgentState } from "@/lib/types";

/* ── Hexagonal path generator (flat-top hexagon) ────────── */
export function hexPath(r: number): string {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return `M${points.join("L")}Z`;
}

/* ── Render the visual elements inside a node <g> ──────── */
export function renderNodeVisuals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g: Selection<SVGGElement, any, any, any>,
  agent: AgentState,
  selectedAgentId: string | null,
  depth?: number,
  workflowLabel?: string,
) {
  const color = agentColor(agent);
  // Plugin-namespaced agent names ("voltagent-core-dev:backend-developer")
  // get the prefix stripped for the type label. Workflow nodes instead render
  // their real label (workflowLabel, e.g. "find:A-line-scan") verbatim via subLabel.
  const rawDisplay = agent.displayType || AGENT_LABELS[agent.agentType] || "AGENT";
  const typeLabel = rawDisplay.split(":").pop()!.toUpperCase();
  const liveFallback = agent.workflowName ? agent.workflowName.toUpperCase() : typeLabel;
  const subLabel = workflowLabel || liveFallback;
  const effortFromMeta = typeof agent.metadata?.effort === "string"
    ? agent.metadata.effort
    : undefined;
  const effort = agent.effort ?? effortFromMeta;
  const showName = agent.agentType !== "main";
  // Hexagon center shows the model family ("Fable"/"Opus"/"Sonnet"/"Haiku")
  // when known; falls back to the agent-type initial otherwise.
  const modelMatch = agent.model?.match(/claude-(fable|opus|sonnet|haiku)/i);
  const modelName = modelMatch ? modelMatch[1].toUpperCase() : null;
  const centerText = modelName ?? typeLabel.charAt(0);
  // When an effort tier is set, stack it as a second center line under the
  // model name so the active thinking tier reads at a glance.
  const showEffortLine = !!effort;
  const isSelected = agent.id === selectedAgentId;
  const isActive = agent.status === "running" || agent.status === "idle";
  const isRunning = agent.status === "running";

  const isSubAgent = !!(agent.parentId && !agent.teamId);
  const isFinished = agent.status === "completed" || agent.status === "error";
  // Sub-agents also dim when they go idle; main agents stay at full opacity
  // between turns so a waiting session doesn't look "done".
  const isDimmed = isFinished || (isSubAgent && agent.status === "idle");

  // Effective radius & scale (used by backplate, body hex, and label sizing).
  // Nested sub-agents shrink per nesting level; depth 1 / undefined is a no-op.
  const r = getNodeRadius(agent, depthFactor(depth));
  const scale = r / GRAPH.nodeRadius;

  // Opaque backplate keeps links occluded when the rest of the node dims —
  // group opacity would otherwise make the hex fill translucent and the
  // bezier link behind would bleed through.
  g.append("path")
    .attr("d", hexPath(r))
    .attr("fill", "var(--color-bg)");

  const work = isDimmed ? g.append("g").attr("opacity", 0.35) : g;
  // 24px base is right for a single letter; full model names need a smaller
  // base so "Sonnet" (6 chars × ~0.6em) clears the hexagon's interior width.
  // Size off the longer of the two center lines so a wide effort word
  // ("MEDIUM") shrinks like "SONNET" instead of overflowing the hexagon.
  const centerLen = effort ? Math.max(centerText.length, effort.length) : centerText.length;
  const centerFontBase = centerLen <= 1 ? 24 : 14;
  const centerFontMin = centerLen <= 1 ? 13 : 8;
  const centerFont = Math.max(centerFontMin, Math.round(centerFontBase * scale));
  const labelY = Math.round(52 * scale);
  const labelFontSize = Math.max(8, Math.round(13 * scale));
  // Outer glow/pulsing ring radius — scaled for sub-agents so the rings
  // hug the smaller hexagon instead of using the main-agent constant.
  const glowR = isSubAgent ? r + Math.round(8 * scale) : GRAPH.glowRingRadius;

  // Pulsing ring for active agents
  if (isActive) {
    const ring = work.append("path")
      .attr("d", hexPath(glowR + 4))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0);
    ring.append("animate")
      .attr("attributeName", "stroke-opacity")
      .attr("values", isRunning ? "0.1;0.5;0.1" : "0.05;0.25;0.05")
      .attr("dur", isRunning ? "1.5s" : "2.5s")
      .attr("repeatCount", "indefinite");
  }

  // Outer glow ring for selected/active
  if (isSelected || isActive) {
    work.append("path")
      .attr("d", hexPath(glowR))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", isSelected ? 2 : 1)
      .attr("stroke-opacity", isActive ? 0.4 : 0.3)
      .attr("filter", "url(#glow)");
  }

  // ── Node shape: hexagon for all agents (sub-agents use smaller radius via `r`) ──
  {
    const glowOuter = isSubAgent ? r + Math.round(8 * scale) : GRAPH.nodeRadius + 10;
    const glowInner = isSubAgent ? r + Math.round(4 * scale) : GRAPH.nodeRadius + 5;
    const innerDetail = isSubAgent ? r - Math.round(7 * scale) : GRAPH.nodeRadius - 8;

    if (isActive) {
      const outerGlow = work.append("path")
        .attr("d", hexPath(glowOuter))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.2);
      outerGlow.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "0.1;0.35;0.1")
        .attr("dur", isRunning ? "1.5s" : "2.5s")
        .attr("repeatCount", "indefinite");

      work.append("path")
        .attr("d", hexPath(glowInner))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.35);
    }

    const mainHex = work.append("path")
      .attr("d", hexPath(r))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", isActive ? 2.5 : 2);

    if (isRunning) {
      mainHex.append("animate")
        .attr("attributeName", "stroke-opacity")
        .attr("values", "1;0.6;1")
        .attr("dur", "1.5s")
        .attr("repeatCount", "indefinite");
    }

    if (isActive) {
      work.append("path")
        .attr("d", hexPath(innerDetail))
        .attr("fill", "none")
        .attr("stroke", `${color}44`)
        .attr("stroke-width", 1);
    }
  }

  // Letter(s) inside node — single line by default, stacked model + effort
  // tier when an effort is set.
  if (showEffortLine) {
    // The model family is the headline (bold); the effort tier sits under it
    // smaller and at normal weight so it reads as a secondary line.
    const modelFont = Math.max(centerFontMin, Math.round(centerFontBase * scale * 0.85));
    const effortFont = Math.max(6, Math.round(modelFont * 0.6));
    const gap = Math.max(1, Math.round(scale * 2));
    // Center the differently-sized pair on y=0: the gap sits between the two
    // lines and the whole block straddles the origin.
    const modelY = -(gap + effortFont) / 2;
    const effortY = (gap + modelFont) / 2;
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("y", modelY)
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", modelFont)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(centerText);
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("y", effortY)
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", effortFont)
      .attr("font-weight", "normal")
      .style("pointer-events", "none")
      .text(effort!.toUpperCase());
  } else {
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", centerFont)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(centerText);
  }

  // Line 1: agent name (hidden for main agents)
  if (showName) {
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("y", labelY)
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", labelFontSize)
      .attr("font-weight", "bold")
      .attr("letter-spacing", "2px")
      .style("pointer-events", "none")
      .text(subLabel);
  }

  // Below the hex for the MAIN agent (where sub-agents show their name):
  // the session's repo — the last path segment of metadata.projectName,
  // e.g. "Users/erdos/Github/agents" → "AGENTS".
  if (agent.agentType === "main") {
    const projectName = typeof agent.metadata?.projectName === "string"
      ? agent.metadata.projectName
      : undefined;
    const repo = projectName?.split("/").filter(Boolean).pop();
    // Smaller than the sub-agent name label so the repo reads as a quiet caption.
    const repoFontSize = Math.max(7, Math.round(10 * scale));
    if (repo) {
      work.append("text")
        .attr("text-anchor", "middle")
        .attr("y", labelY)
        .attr("fill", color)
        .attr("font-family", "monospace")
        .attr("font-size", repoFontSize)
        .attr("font-weight", "bold")
        .attr("letter-spacing", "2px")
        .style("pointer-events", "none")
        .text(repo.toUpperCase());
    }
  }

}
