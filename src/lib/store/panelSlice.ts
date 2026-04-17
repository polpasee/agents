import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";
import type { LogEntry, FileModification, MetricSample, Annotation } from "../types";
import { METRIC_HISTORY_MAX } from "../config";

export type PanelSlice = Pick<AgentStore,
  | "logEntries" | "logLoading" | "logViewerAgentId"
  | "agentDiffs" | "diffViewerAgentId"
  | "errorDrillDownAgentId"
  | "budgetThreshold" | "metricHistory" | "annotations"
  | "openLogViewer" | "closeLogViewer" | "setLogEntries" | "setLogLoading"
  | "openDiffViewer" | "closeDiffViewer" | "setAgentDiffs"
  | "openErrorDrillDown" | "closeErrorDrillDown"
  | "setBudgetThreshold"
  | "pushMetricSample"
  | "addAnnotation" | "removeAnnotation" | "updateAnnotation"
>;

export const createPanelSlice: StateCreator<AgentStore, [], [], PanelSlice> = (set, get) => ({
  // ── Log Viewer ────────────────────────────────────────
  logEntries: new Map(),
  logLoading: new Set(),
  logViewerAgentId: null,

  openLogViewer: (agentId) => set({ logViewerAgentId: agentId }),
  closeLogViewer: () => set({ logViewerAgentId: null }),

  setLogEntries: (agentId, entries) => {
    const logEntries = new Map(get().logEntries);
    logEntries.set(agentId, entries);
    const logLoading = new Set(get().logLoading);
    logLoading.delete(agentId);
    set({ logEntries, logLoading });
  },

  setLogLoading: (agentId, loading) => {
    const logLoading = new Set(get().logLoading);
    if (loading) logLoading.add(agentId);
    else logLoading.delete(agentId);
    set({ logLoading });
  },

  // ── Cost Budget (hydrated client-side via hydrateUI) ──
  budgetThreshold: null,

  setBudgetThreshold: (amount) => {
    if (typeof window !== "undefined") {
      if (amount !== null) localStorage.setItem("budgetThreshold", String(amount));
      else localStorage.removeItem("budgetThreshold");
    }
    set({ budgetThreshold: amount });
  },

  // ── F2: Error Drill-Down panel ────────────────────────
  errorDrillDownAgentId: null,

  openErrorDrillDown: (agentId) => set({ errorDrillDownAgentId: agentId }),
  closeErrorDrillDown: () => set({ errorDrillDownAgentId: null }),

  // ── F4: Live Metrics ──────────────────────────────────
  metricHistory: [],

  pushMetricSample: (sample) => {
    const history = [...get().metricHistory, sample].slice(-METRIC_HISTORY_MAX);
    set({ metricHistory: history });
  },

  // ── F6: Annotations ───────────────────────────────────
  annotations: new Map(),

  addAnnotation: (annotation) => {
    const annotations = new Map(get().annotations);
    annotations.set(annotation.id, annotation);
    set({ annotations });
  },

  removeAnnotation: (id) => {
    const annotations = new Map(get().annotations);
    annotations.delete(id);
    set({ annotations });
  },

  updateAnnotation: (id, updates) => {
    const annotations = new Map(get().annotations);
    const existing = annotations.get(id);
    if (existing) {
      annotations.set(id, { ...existing, ...updates });
      set({ annotations });
    }
  },

  // ── F8: Diff View ─────────────────────────────────────
  agentDiffs: new Map(),
  diffViewerAgentId: null,

  setAgentDiffs: (agentId, diffs) => {
    const agentDiffs = new Map(get().agentDiffs);
    agentDiffs.set(agentId, diffs);
    set({ agentDiffs });
  },

  openDiffViewer: (agentId) => set({ diffViewerAgentId: agentId }),
  closeDiffViewer: () => set({ diffViewerAgentId: null }),
});
