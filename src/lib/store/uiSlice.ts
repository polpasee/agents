import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";
import { loadLocalStorage } from "./helpers";
import type { ThemeMode, GraphLayout, ComparisonState, HeatmapMetric } from "../types";

export type UISlice = Pick<AgentStore,
  | "selectedAgentId" | "selectedTeamId" | "selectedSessionIds"
  | "sessionFilterInitialized"
  | "viewMode" | "hiddenAgentTypes"
  | "transcriptOpen" | "fileAttentionOpen"
  | "heatmapEnabled" | "heatmapMetric"
  | "graphLayout" | "showExportModal" | "showLiveMetrics"
  | "theme" | "soundMuted" | "comparison"
  | "selectAgent" | "selectTeam" | "toggleSession" | "selectAllSessions"
  | "autoSelectInitialSession"
  | "setViewMode" | "toggleAgentType"
  | "toggleTranscript" | "toggleFileAttention"
  | "toggleHeatmap" | "setHeatmapMetric"
  | "setGraphLayout" | "toggleExportModal" | "toggleLiveMetrics"
  | "toggleTheme" | "toggleSoundMute"
  | "loadComparison" | "exitComparison"
  | "hydrateUI"
>;

const SESSION_FILTER_KEY = "selectedSessionIds";

function persistSessionFilter(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_FILTER_KEY, JSON.stringify([...ids]));
  } catch { /* quota / privacy mode — silently skip, in-memory state is still correct */ }
}

export const createUISlice: StateCreator<AgentStore, [], [], UISlice> = (set, get) => ({
  selectedAgentId: null,
  selectedTeamId: null,
  selectedSessionIds: new Set(), // F5: empty = all sessions
  sessionFilterInitialized: false,

  selectAgent: (id) => set({ selectedAgentId: id }),

  // F5: multi-session toggle. Any user toggle counts as "initialized" so the
  // boot-time auto-pick won't fire afterward and clobber their choice.
  toggleSession: (sessionId) => {
    const { selectedSessionIds } = get();
    const next = new Set(selectedSessionIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    persistSessionFilter(next);
    set({ selectedSessionIds: next, selectedAgentId: null, sessionFilterInitialized: true });
  },

  selectAllSessions: () => {
    const empty = new Set<string>();
    persistSessionFilter(empty);
    set({ selectedSessionIds: empty, selectedAgentId: null, sessionFilterInitialized: true });
  },

  autoSelectInitialSession: () => {
    const { agents, selectedSessionIds, sessionFilterInitialized } = get();
    if (sessionFilterInitialized) return;
    if (selectedSessionIds.size > 0) {
      // Hydration restored a prior selection — just mark initialized.
      set({ sessionFilterInitialized: true });
      return;
    }
    // Pick the most-recently-started main session (parentless agents define a session).
    let bestId: string | null = null;
    let bestStart = -Infinity;
    for (const a of agents.values()) {
      if (a.parentId) continue;
      if (a.startTime > bestStart) {
        bestStart = a.startTime;
        bestId = a.sessionId || a.id;
      }
    }
    if (!bestId) return; // no eligible session yet — try again on the next agent arrival
    const next = new Set<string>([bestId]);
    persistSessionFilter(next);
    set({ selectedSessionIds: next, sessionFilterInitialized: true });
  },

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
  // Centralizes every localStorage-backed field so SSR renders a stable default
  // and client-side hydration brings them in via a single `useEffect` in <Dashboard>.
  hydrateUI: () => {
    const stored = loadLocalStorage<string[] | null>(SESSION_FILTER_KEY, null);
    const updates: Partial<AgentStore> = {
      soundMuted: loadLocalStorage("soundMuted", false),
      theme: loadLocalStorage<ThemeMode>("theme", "dark"),
      budgetThreshold: loadLocalStorage<number | null>("budgetThreshold", null),
      agentTypeBudgets: loadLocalStorage("agentTypeBudgets", {}),
    };
    if (Array.isArray(stored)) {
      // Storage present (incl. empty array = explicit "All") — respect it and
      // do NOT auto-pick later. Empty array means user already chose "show all".
      updates.selectedSessionIds = new Set(stored);
      updates.sessionFilterInitialized = true;
    }
    set(updates);
  },
});
