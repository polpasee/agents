import type { AgentType } from "../../src/lib/types";

// ── Parse agent type from meta.json or slug ────────────
export function parseAgentType(raw?: string): AgentType {
  if (!raw) return "generic";
  const lower = raw.toLowerCase();

  if (lower.includes("team-lead")) return "team-lead";
  // Compound names must resolve before their component words fire elsewhere
  if (lower.includes("code-architect") || lower.includes("code-simplifier"))
    return "build";
  // "analyzer" (review tool) must precede the "analy" → explore catch-all below
  // "failure-hunter" and "auditor" are review signals
  if (
    lower.includes("review") ||
    lower.includes("audit") ||
    lower.includes("critic") ||
    lower.includes("analyzer") ||
    lower.includes("failure-hunter")
  )
    return "review";
  // \bqa\b(?!-) avoids matching "qa-sec" namespace segments; qa as a trailing role still matches
  if (lower.includes("test") || /\bqa\b(?!-)/.test(lower)) return "test";
  if (
    lower.includes("explore") ||
    lower.includes("research") ||
    lower.includes("analy") ||
    lower.includes("investigat") ||
    /\breader\b/.test(lower)
  )
    return "explore";
  // "ui-designer" carve-out: listed under Build in the cheatsheet; must come before
  // the generic "design" → plan rule that would otherwise capture it
  if (
    lower.includes("plan") ||
    (lower.includes("architect") && !lower.includes("code-architect")) ||
    (lower.includes("design") && !lower.includes("ui-designer"))
  )
    return "plan";
  if (
    lower.includes("build") ||
    lower.includes("frontend") ||
    lower.includes("backend") ||
    lower.includes("implement") ||
    lower.includes("migrat") ||
    lower.includes("debug") ||
    /\bfix\b/.test(lower) ||
    /\bapi\b/.test(lower) ||
    /\bui\b/.test(lower) ||
    lower.includes("engineer") ||
    lower.includes("specialist") ||
    lower.includes("developer") ||
    lower.includes("optimizer") ||
    lower.includes("expert") ||
    lower.includes("designer") ||
    /-pro\b/.test(lower)
  )
    return "build";

  return "generic";
}
