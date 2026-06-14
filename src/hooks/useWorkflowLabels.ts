"use client";
import { useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { buildWorkflowLabelMap } from "@/lib/workflowLabels";

export function useWorkflowLabels() {
  const workflows = useAgentStore((s) => s.workflows);
  return useMemo(() => buildWorkflowLabelMap(workflows), [workflows]);
}
