import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";
import { loadLocalStorage } from "./helpers";
import type { ThemeMode, GraphLayout, ComparisonState, HeatmapMetric } from "../types";

export type UISlice = Pick<AgentStore,
  | "selectedAgentId" | "selectedTeamId" | "selectedSessionIds"
  | "viewMode" | "hiddenAgentTypes"
  | "transcriptOpen" | "fileAttentionOpen"
  | "heatmapEnabled" | "heatmapMetric"
  | "graphLayout" | "showExportModal" | "showLiveMetrics"
  | "theme" | "soundMuted" | "comparison"
  | "selectAgent" | "selectTeam" | "toggleSession" | "selectAllSessions"
  | "setViewMode" | "toggleAgentType"
  | "toggleTranscript" | "toggleFileAttention"
  | "toggleHeatmap" | "setHeatmapMetric"
  | "setGraphLayout" | "toggleExportModal" | "toggleLiveMetrics"
  | "toggleTheme" | "toggleSoundMute"
  | "loadComparison" | "exitComparison"
  | "hydrateUI"
>;

export const createUISlice: StateCreator<AgentStore, [], [], UISlice> = (set, get) => ({
  selectedAgentId: null,
  selectedTeamId: null,
  selectedSessionIds: new Set(), // F5: empty = all sessions

  selectAgent: (id) => set({ selectedAgentId: id }),

  // F5: multi-session toggle
  toggleSession: (sessionId) => {
    const { selectedSessionIds } = get();
    const next = new Set(selectedSessionIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    set({ selectedSessionIds: next, selectedAgentId: null });
  },

  selectAllSessions: () => set({ selectedSessionIds: new Set(), selectedAgentId: null }),

  selectTeam: (teamId) => set({ selectedTeamId: teamId }),

  viewMode: "graph",
  setViewMode: (mode) => set({ viewMode: mode }),

  hiddenAgentTypes: new Set(),
  toggleAgentType: (type) => {
    const { hiddenAgentTypes } = get();
    const next = new Set(hiddenAgentTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    set({ hiddenAgentTypes: next });
  },

  transcriptOpen: false,
  fileAttentionOpen: false,
  toggleTranscript: () => set((s) => ({ transcriptOpen: !s.transcriptOpen })),
  toggleFileAttention: () => set((s) => ({ fileAttentionOpen: !s.fileAttentionOpen })),

  // ── Heatmap ───────────────────────────────────────────
  heatmapEnabled: false,
  heatmapMetric: "tokenEfficiency",

  toggleHeatmap: () => set({ heatmapEnabled: !get().heatmapEnabled }),
  setHeatmapMetric: (metric) => set({ heatmapMetric: metric }),

  // ── F10: Export Report ────────────────────────────────
  showExportModal: false,
  toggleExportModal: () => set({ showExportModal: !get().showExportModal }),

  // ── F4: Live Metrics toggle ───────────────────────────
  showLiveMetrics: false,
  toggleLiveMetrics: () => set({ showLiveMetrics: !get().showLiveMetrics }),

  // ── F11: Theme ────────────────────────────────────────
  theme: "dark" as ThemeMode, // Hydrated from localStorage on client mount

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", next);
    }
    set({ theme: next });
  },

  // ── F12: Graph Layout ─────────────────────────────────
  graphLayout: "force",
  setGraphLayout: (layout) => set({ graphLayout: layout }),

  // ── F14: Session Comparison ───────────────────────────
  comparison: { active: false, leftSession: null, rightSession: null },

  loadComparison: (left, right) => set({
    comparison: { active: true, leftSession: left, rightSession: right },
  }),

  exitComparison: () => set({
    comparison: { active: false, leftSession: null, rightSession: null },
  }),

  // ── Sound ──────────────────────────────────────────
  soundMuted: false, // Hydrated from localStorage on client mount

  toggleSoundMute: () => {
    const next = !get().soundMuted;
    if (typeof window !== "undefined") {
      localStorage.setItem("soundMuted", JSON.stringify(next));
    }
    set({ soundMuted: next });
  },

  // ── Hydration: sync from localStorage after client mount ──
  hydrateUI: () => {
    set({
      soundMuted: loadLocalStorage("soundMuted", false),
      theme: loadLocalStorage<ThemeMode>("theme", "dark"),
    });
  },
});
