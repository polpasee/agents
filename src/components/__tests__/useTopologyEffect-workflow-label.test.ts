import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentState, WorkflowRunState } from "@/lib/types";
import { LAYOUT_TUNING_DEFAULTS } from "@/lib/config";
import { mockAgent, mockWorkflowRun } from "@/lib/__tests__/test-utils";
import { useTopologyEffect } from "../AgentGraph/useTopologyEffect";
import type { AgentGraphRefs } from "../AgentGraph/refs";

function makeRefs(): AgentGraphRefs {
  const container = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  return {
    svgRef: { current: svg },
    containerRef: { current: container },
    simulationRef: { current: null },
    nodesRef: { current: [] },
    linksRef: { current: [] },
    toolNodesRef: { current: [] },
    toolLinksRef: { current: [] },
    zoomRef: { current: null },
    effectsRef: { current: [] },
    prevActivityLenRef: { current: 0 },
  };
}

describe("useTopologyEffect — workflow label stamping", () => {
  it("stamps workflowLabel on matching nodes, guards label===agentId, leaves plain nodes untouched", () => {
    const main = mockAgent({ id: "main" });
    const wf1 = mockAgent({ id: "wf1", parentId: "main" });
    const wf2 = mockAgent({ id: "wf2", parentId: "main" });
    const plain = mockAgent({ id: "plain", parentId: "main" });

    const agents = new Map<string, AgentState>([
      ["main", main],
      ["wf1", wf1],
      ["wf2", wf2],
      ["plain", plain],
    ]);

    const run: WorkflowRunState = mockWorkflowRun({
      runId: "run-1",
      agentCount: 2,
      agents: [
        { agentId: "wf1", label: "find:A-line-scan", state: "running" },
        // label === agentId: the workflow-scan fallback; guard must skip this
        { agentId: "wf2", label: "wf2", state: "running" },
      ],
    });
    const workflows = new Map<string, WorkflowRunState>([["run-1", run]]);

    const refs = makeRefs();
    renderHook(() =>
      useTopologyEffect(refs, {
        filteredAgents: [main, wf1, wf2, plain],
        edges: [],
        agents,
        teams: new Map(),
        workflows,
        selectedAgentId: null,
        selectedTeamId: null,
        selectedWorkflowId: null,
        topologyVersion: 1,
        selectAgent: vi.fn(),
        layoutTuning: { ...LAYOUT_TUNING_DEFAULTS },
      }),
    );

    const nodeMap = new Map(refs.nodesRef.current.map((n) => [n.id, n]));

    // wf1 has a meaningful label — must be stamped
    expect(nodeMap.get("wf1")?.workflowLabel).toBe("find:A-line-scan");

    // wf2's label equals its agentId — guard must leave it undefined
    expect(nodeMap.get("wf2")?.workflowLabel).toBeUndefined();

    // plain is not in any workflow run — must remain undefined
    expect(nodeMap.get("plain")?.workflowLabel).toBeUndefined();
  });
});
