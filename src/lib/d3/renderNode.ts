import * as d3 from "d3";
import { AGENT_LABELS, agentColor } from "@/lib/colors";
import { GRAPH } from "@/lib/config";
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

/* ── Wrap tool text into multi-line array for activity circle ── */
export function wrapToolText(tool: string, args: string | undefined, maxLines: number, maxChars: number): string[] {
  // Truncate tool name to fit within maxChars
  const toolLabel = tool.toUpperCase() + ":";
  const firstLine = toolLabel.length > maxChars
    ? toolLabel.slice(0, maxChars - 2) + ".."
    : toolLabel;
  const lines: string[] = [firstLine];
  if (!args) return lines;

  // Word-wrap: split into words, fill lines without breaking words
  const words = args.split(/(\s+|(?<=[:,/])|(?=\/))/);
  let currentLine = "";

  for (const word of words) {
    if (lines.length >= maxLines) break;
    const trimmed = word.replace(/^\s+/, "");
    if (!trimmed) {
      if (currentLine) currentLine += " ";
      continue;
    }

    if (currentLine.length + trimmed.length <= maxChars) {
      currentLine += trimmed;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        if (lines.length >= maxLines) break;
      }
      // If a single word exceeds maxChars, truncate it
      currentLine = trimmed.length > maxChars
        ? trimmed.slice(0, maxChars - 4) + "...."
        : trimmed;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Truncate last line with ellipsis if we ran out of space
  if (lines.length >= maxLines && lines[lines.length - 1].length > maxChars) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, maxChars - 4) + "....";
  }

  return lines.slice(0, maxLines);
}

/* ── Render the visual elements inside a node <g> ──────── */
export function renderNodeVisuals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g: d3.Selection<SVGGElement, any, any, any>,
  agent: AgentState,
  selectedAgentId: string | null,
) {
  const color = agentColor(agent);
  // Caption layout under the hexagon is two lines max:
  //   Line 1: agent name (hidden for main agents)
  //   Line 2: extended-thinking effort tier (when known)
  // Slug and model-name labels were removed — model identity still appears as
  // the O/S/H letter in the hexagon center.
  // Plugin-namespaced agent names ("voltagent-core-dev:backend-developer")
  // get the prefix stripped — only the agent name itself reads under the
  // hexagon. Defensive: also handle multi-colon names by keeping the last segment.
  const rawDisplay = agent.displayType || AGENT_LABELS[agent.agentType] || "AGENT";
  const typeLabel = rawDisplay.split(":").pop()!.toUpperCase();
  const effortFromMeta = typeof agent.metadata?.effort === "string"
    ? (agent.metadata.effort as string)
    : undefined;
  const effort = agent.effort ?? effortFromMeta;
  const showName = agent.agentType !== "main";
  // Model family letter for the node center: O=Opus, S=Sonnet, H=Haiku.
  // Falls back to the type initial when the model is unknown.
  const modelMatch = agent.model?.match(/claude-(opus|sonnet|haiku)/i);
  const modelName = modelMatch ? modelMatch[1].toUpperCase() : null;
  // Full model name in the hexagon center ("Opus"/"Sonnet"/"Haiku"); falls
  // back to the type initial when the model is unknown.
  const centerText = modelName ?? typeLabel.charAt(0);
  // When the user has the 1M-context beta on, render a second smaller "1M"
  // line under the model name so it's obvious at a glance.
  const showContextLine = !!modelName && !!agent.is1MContext;
  const isSelected = agent.id === selectedAgentId;
  const isActive = agent.status === "running" || agent.status === "idle";
  const isRunning = agent.status === "running";

  const isSubAgent = !!(agent.parentId && !agent.teamId);
  const isFinished = agent.status === "completed" || agent.status === "error";
  // Sub-agents also dim when they go idle; main agents stay at full opacity
  // between turns so a waiting session doesn't look "done".
  const isDimmed = isFinished || (isSubAgent && agent.status === "idle");

  // Opaque backplate keeps links occluded when the rest of the node dims —
  // group opacity would otherwise make the hex fill translucent and the
  // bezier link behind would bleed through.
  g.append("path")
    .attr("d", hexPath(isSubAgent ? GRAPH.subAgentNodeRadius : GRAPH.nodeRadius))
    .attr("fill", "var(--color-bg)");

  const work = isDimmed ? g.append("g").attr("opacity", 0.35) : g;

  // ── Effective radius & scale for sub-agents ──
  const r = isSubAgent ? GRAPH.subAgentNodeRadius : GRAPH.nodeRadius;
  const scale = r / GRAPH.nodeRadius;
  // 24px base is right for a single letter; full model names need a smaller
  // base so "Sonnet" (6 chars × ~0.6em) clears the hexagon's interior width.
  const centerFontBase = centerText.length <= 1 ? 24 : 14;
  const centerFontMin = centerText.length <= 1 ? 13 : 8;
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

  // Letter(s) inside node — single line by default, stacked model + "1M"
  // when the 1M-context beta is enabled.
  if (showContextLine) {
    // Both lines share font size + color so "Opus / 1M" reads as one block.
    const lineFont = Math.max(centerFontMin, Math.round(centerFontBase * scale * 0.85));
    const gap = Math.max(1, Math.round(scale * 2));
    // Symmetric offsets — equal font sizes mean the group's visual center
    // sits exactly at y=0.
    const halfStride = (lineFont + gap) / 2;
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("y", -halfStride)
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", lineFont)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(centerText);
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("y", halfStride)
      .attr("fill", color)
      .attr("font-family", "monospace")
      .attr("font-size", lineFont)
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text("1M");
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
      .text(typeLabel);
  }

  // Line 2: effort tier — sits at line-1 position when the name is hidden
  if (effort) {
    const effortY = showName ? labelY + Math.round(14 * scale) : labelY;
    work.append("text")
      .attr("text-anchor", "middle")
      .attr("y", effortY)
      .attr("fill", showName ? `${color}99` : color)
      .attr("font-family", "monospace")
      .attr("font-size", Math.max(6, Math.round(9 * scale)))
      .attr("font-weight", showName ? "normal" : "bold")
      .attr("letter-spacing", "2px")
      .style("pointer-events", "none")
      .text(effort.toUpperCase());
  }

}
