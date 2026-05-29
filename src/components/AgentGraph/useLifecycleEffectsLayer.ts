import { useEffect } from "react";
import { select } from "d3-selection";
import { UI, agentColor } from "@/lib/colors";
import { GRAPH, getNodeRadius } from "@/lib/config";
import { hexPath } from "@/lib/d3";
import type { SimNode } from "@/lib/d3";
import type { AgentState, ActivityEntry } from "@/lib/types";
import type { AgentGraphRefs, LifecycleEffect } from "./refs";

interface Options {
  agents: Map<string, AgentState>;
  activity: ActivityEntry[];
}

/**
 * P-H1 fix: lifecycle effect rendering moved off the simulation tick (which
 * fired at 30–60 Hz and called `effectsGroup.selectAll("*").remove()`) onto a
 * dedicated `requestAnimationFrame` loop that is only running while there is
 * something to draw.
 *
 * Two pieces:
 *
 *   1. Push effect: watches the activity stream tail and pushes new
 *      spawn/complete/error effects into `effectsRef`. (Was Effect 2a.)
 *
 *   2. Drain effect: starts a RAF loop when there is at least one effect
 *      queued. The loop expires entries past their duration, and uses a
 *      keyed D3 enter/update/exit join so primitives (path / circle) are
 *      reused frame to frame instead of being torn down and re-created.
 *
 * Reads:  effectsRef, activity, agents, svgRef, nodesRef
 * Writes: effectsRef (push), `g.effects` SVG group (RAF)
 */
export function useLifecycleEffectsLayer(refs: AgentGraphRefs, opts: Options) {
  const { agents, activity } = opts;

  // ── Push: turn activity tail into effect entries ──
  useEffect(() => {
    if (activity.length === 0) return;
    // Track by the monotonic numeric id embedded in each entry's string id
    // ("act-N") rather than by array length. The activity array is capped at
    // ACTIVITY_MAX_ENTRIES; once saturated, length stays constant and
    // slice(cap) always returns [] — animations would stop permanently.
    // prevActivityLenRef is reused here to store the last-seen numeric id
    // (initialized to -1 via useAgentGraphRefs which sets it to 0; the first
    // real entry has id >= 1, so id > 0 is always safe as the initial guard).
    const lastSeenId = refs.prevActivityLenRef.current;
    const activityNumId = (e: ActivityEntry) => parseInt(e.id.replace("act-", ""), 10);
    const newEntries = activity.filter((e) => activityNumId(e) > lastSeenId);
    if (activity.length > 0) {
      refs.prevActivityLenRef.current = activityNumId(activity[activity.length - 1]);
    }

    for (const entry of newEntries) {
      let effectNode: SimNode | undefined;
      let effectType: "spawn" | "complete" | "error" | null = null;
      const evt = entry.event;

      switch (evt.type) {
        case "agent:register":
          effectNode = refs.nodesRef.current.find((n) => n.id === evt.agentId);
          effectType = "spawn";
          break;
        case "agent:complete":
          effectNode = refs.nodesRef.current.find((n) => n.id === evt.agentId);
          effectType = "complete";
          break;
        case "agent:status":
          if (evt.status === "error") {
            effectNode = refs.nodesRef.current.find((n) => n.id === evt.agentId);
            effectType = "error";
          }
          break;
      }

      if (effectNode && effectType && effectNode.x != null && effectNode.y != null) {
        const a = agents.get(effectNode.id);
        const color = a ? agentColor(a) : UI.text.secondary;
        const effectRadius = a ? getNodeRadius(a) : GRAPH.nodeRadius;
        refs.effectsRef.current.push({
          x: effectNode.x,
          y: effectNode.y,
          color,
          type: effectType,
          startTime: Date.now(),
          duration: effectType === "error" ? 800 : 1000,
          effectRadius,
        });
      }
    }
    // We intentionally don't depend on `agents`: the push happens on activity
    // tail growth; agent identity at push time is good enough for color.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  // ── Drain: render queued effects on RAF, only while queue is non-empty ──
  useEffect(() => {
    let rafId: number | null = null;
    let running = false;

    const effectKey = (e: LifecycleEffect) => `${e.startTime}:${e.x}:${e.y}`;

    const tick = () => {
      const svg = refs.svgRef.current;
      if (!svg) {
        running = false;
        rafId = null;
        return;
      }
      const effectsGroup = select(svg).select<SVGGElement>("g.effects");
      if (effectsGroup.empty()) {
        running = false;
        rafId = null;
        return;
      }

      const now = Date.now();
      // Expire finished effects
      const live = refs.effectsRef.current.filter((e) => now - e.startTime < e.duration);
      refs.effectsRef.current = live;

      // Keyed enter/update/exit join — reuse primitives instead of removing all
      const groups = effectsGroup
        .selectAll<SVGGElement, LifecycleEffect>("g.effect")
        .data(live, effectKey);

      groups.exit().remove();

      const enter = groups.enter().append("g").attr("class", "effect");
      enter.each(function (e) {
        const g = select(this);
        if (e.type === "spawn") {
          g.append("path")
            .attr("class", "ring")
            .attr("fill", "none")
            .attr("stroke", e.color);
        } else if (e.type === "complete") {
          g.append("circle")
            .attr("class", "ring")
            .attr("fill", "none")
            .attr("stroke", "#00ff88");
          g.append("circle")
            .attr("class", "flash")
            .attr("fill", "white");
        } else {
          g.append("circle")
            .attr("class", "ring")
            .attr("fill", "none")
            .attr("stroke", UI.error);
        }
      });

      const merged = enter.merge(groups);
      merged.each(function (e) {
        const progress = (now - e.startTime) / e.duration;
        const alpha = 1 - progress;
        const g = select(this);

        if (e.type === "spawn") {
          const er = e.effectRadius + progress * 40;
          g.select<SVGPathElement>("path.ring")
            .attr("d", hexPath(er))
            .attr("transform", `translate(${e.x},${e.y})`)
            .attr("stroke-width", 2 * alpha)
            .attr("stroke-opacity", alpha * 0.6);
        } else if (e.type === "complete") {
          const er = e.effectRadius + progress * 60;
          g.select<SVGCircleElement>("circle.ring")
            .attr("cx", e.x)
            .attr("cy", e.y)
            .attr("r", er)
            .attr("stroke-width", 1.5 * alpha)
            .attr("stroke-opacity", alpha * 0.5);
          const flash = g.select<SVGCircleElement>("circle.flash");
          if (progress < 0.3) {
            const flashAlpha = (0.3 - progress) / 0.3;
            flash
              .attr("cx", e.x)
              .attr("cy", e.y)
              .attr("r", e.effectRadius)
              .attr("opacity", flashAlpha * 0.15);
          } else {
            flash.attr("opacity", 0);
          }
        } else {
          const er = e.effectRadius + progress * 30;
          g.select<SVGCircleElement>("circle.ring")
            .attr("cx", e.x)
            .attr("cy", e.y)
            .attr("r", er)
            .attr("stroke-width", 3 * alpha)
            .attr("stroke-opacity", alpha * 0.7);
        }
      });

      if (live.length === 0) {
        // Nothing to draw — stop the RAF loop until the next push wakes us.
        running = false;
        rafId = null;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    const ensureRunning = () => {
      if (running) return;
      if (refs.effectsRef.current.length === 0) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    };

    // Wake the loop whenever someone pushes (the push effect mutates
    // effectsRef.current synchronously, then React re-runs us via the activity
    // dep below).
    ensureRunning();

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      running = false;
      rafId = null;
    };
    // Re-arm whenever the activity stream advances; the push effect will have
    // mutated effectsRef before we run, and ensureRunning() restarts the loop.
  }, [refs, activity]);
}
