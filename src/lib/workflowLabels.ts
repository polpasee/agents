import type { WorkflowRunState } from "@/lib/types";

export function buildWorkflowLabelMap(
  workflows: Map<string, WorkflowRunState>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const run of workflows.values())
    for (const ref of run.agents)
      if (ref.label && ref.label !== ref.agentId) m.set(ref.agentId, ref.label);
  return m;
}
