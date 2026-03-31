"use client";

import { useAgentStore } from "@/lib/store";
import { calculateCost, formatCost } from "@/lib/costs";
import { UI } from "@/lib/colors";
import { ModalBackdrop } from "./ModalBackdrop";
import type { AgentState } from "@/lib/types";

function buildReportData(agents: Map<string, AgentState>) {
  const agentList = Array.from(agents.values());
  let totalCost = 0;
  let totalTokens = 0;
  let totalDuration = 0;

  for (const agent of agentList) {
    const cost = calculateCost(agent);
    totalCost += cost.total;
    totalTokens += agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
    totalDuration += agent.duration ?? 0;
  }

  const running = agentList.filter((a) => a.status === "running").length;
  const completed = agentList.filter((a) => a.status === "completed").length;
  const errors = agentList.filter((a) => a.status === "error").length;
  const summary = `${agentList.length} agents total: ${running} running, ${completed} completed, ${errors} errors. Total cost: ${formatCost(totalCost)}.`;

  return {
    generatedAt: Date.now(),
    agents: agentList,
    totalCost,
    totalTokens,
    duration: totalDuration,
    summary,
  };
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON(agents: Map<string, AgentState>) {
  const report = buildReportData(agents);
  const content = JSON.stringify(report, null, 2);
  downloadFile(`agent-report-${new Date().toISOString().slice(0, 19)}.json`, content, "application/json");
}

function exportCSV(agents: Map<string, AgentState>) {
  const agentList = Array.from(agents.values());
  const headers = ["id", "type", "status", "tokens", "cost", "duration", "task"];
  const rows = agentList.map((agent) => {
    const cost = calculateCost(agent);
    const tokens = agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
    const escapedTask = `"${(agent.task || "").replace(/"/g, '""')}"`;
    return [agent.id, agent.agentType, agent.status, tokens, cost.total.toFixed(4), agent.duration ?? 0, escapedTask].join(",");
  });
  const content = [headers.join(","), ...rows].join("\n");
  downloadFile(`agent-report-${new Date().toISOString().slice(0, 19)}.csv`, content, "text/csv");
}

function exportMarkdown(agents: Map<string, AgentState>) {
  const report = buildReportData(agents);
  const agentList = report.agents;

  let md = `# Agent Monitor Report\n\n`;
  md += `**Generated:** ${new Date(report.generatedAt).toLocaleString()}\n\n`;
  md += `## Summary\n\n`;
  md += `${report.summary}\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Agents | ${agentList.length} |\n`;
  md += `| Total Tokens | ${report.totalTokens.toLocaleString()} |\n`;
  md += `| Total Cost | ${formatCost(report.totalCost)} |\n`;
  md += `| Total Duration | ${(report.duration / 1000).toFixed(1)}s |\n\n`;
  md += `## Agents\n\n`;
  md += `| ID | Type | Status | Tokens | Cost | Duration | Task |\n`;
  md += `|----|------|--------|--------|------|----------|------|\n`;

  for (const agent of agentList) {
    const cost = calculateCost(agent);
    const tokens = agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreateTokens;
    const dur = agent.duration ? `${(agent.duration / 1000).toFixed(1)}s` : "-";
    const task = (agent.task || "").slice(0, 60).replace(/\|/g, "\\|");
    md += `| ${agent.id.slice(0, 12)} | ${agent.agentType} | ${agent.status} | ${tokens.toLocaleString()} | ${formatCost(cost.total)} | ${dur} | ${task} |\n`;
  }

  downloadFile(`agent-report-${new Date().toISOString().slice(0, 19)}.md`, md, "text/markdown");
}

const exportOptions = [
  { label: "JSON", description: "Full report data", action: exportJSON },
  { label: "CSV", description: "Agent data table", action: exportCSV },
  { label: "Markdown", description: "Formatted report", action: exportMarkdown },
] as const;

export function ExportModal() {
  const showExportModal = useAgentStore((s) => s.showExportModal);
  const toggleExportModal = useAgentStore((s) => s.toggleExportModal);
  const agents = useAgentStore((s) => s.agents);

  if (!showExportModal) return null;

  return (
    <ModalBackdrop onClose={toggleExportModal}>
      <div
        className="rounded-lg border p-6 w-96"
        style={{
          background: "var(--color-panel)",
          borderColor: `${UI.primary}33`,
          boxShadow: `0 0 30px ${UI.primary}11`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-sm font-bold tracking-widest"
            style={{ color: UI.primary }}
          >
            EXPORT REPORT
          </h2>
          <button
            onClick={toggleExportModal}
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{
              color: UI.text.muted,
              border: `1px solid var(--color-border)`,
            }}
          >
            ESC
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: UI.text.secondary }}>
          Export current agent data as a downloadable report.
        </p>

        <div className="flex flex-col gap-2">
          {exportOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => {
                opt.action(agents);
                toggleExportModal();
              }}
              className="flex items-center justify-between px-3 py-2 rounded text-sm font-mono"
              style={{
                background: `${UI.primary}08`,
                border: `1px solid ${UI.primary}22`,
                color: UI.text.primary,
              }}
            >
              <span style={{ color: UI.primary }}>{opt.label}</span>
              <span style={{ color: UI.text.muted, fontSize: 11 }}>
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>
  );
}
