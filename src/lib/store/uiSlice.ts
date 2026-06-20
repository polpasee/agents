import type { StateCreator } from "zustand";
import type { AgentStore } from "./types";
import { loadLocalStorage, saveLocalStorage } from "./helpers";
import type { ThemeMode } from "../types";
import { resolveSessionId } from "../sessions";

export type UISlice = Pick<
  AgentStore,
  | "selectedAgentId"
  | "selectedTeamId"
  | "selectedWorkflowId"
  | "selectedSessionIds"
  | "sessionFilterInitialized"
  | "viewMode"
  | "hiddenAgentTypes"
  | "transcriptOpen"
  | "fileAttentionOpen"
  | "heatmapEnabled"
  | "heatmapMetric"
  | "graphLayout"
  | "showExportModal"
  | "showLiveMetrics"
  | "theme"
  | "soundMuted"
  | "comparison"
  | "selectAgent"
  | "selectTeam"
  | "selectWorkflow"
  | "toggleSession"
  | "selectOnlySession"
  | "selectAllSessions"
  | "autoSelectInitialSession"
  | "setViewMode"
  | "toggleAgentType"
  | "toggleTranscript"
  | "toggleFileAttention"
  | "toggleHeatmap"
  | "setHeatmapMetric"
  | "setGraphLayout"
  | "toggleExportModal"
  | "toggleLiveMetrics"
  | "toggleTheme"
  | "toggleSoundMute"
  | "loadComparison"
  | "exitComparison"
  | "hydrateUI"
>;

const SESSION_FILTER_KEY = "selectedSessionIds";

function persistSessionFilter(ids: Set<string>) {
  saveLocalStorage(SESSION_FILTER_KEY, [...ids]);
}

export const createUISlice: StateCreator<AgentStore, [], [], UISlice> = (
  set,
  get,
) => ({
  selectedAgentId: null,
  selectedTeamId: null,
  selectedWorkflowId: null,
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
    set({
      selectedSessionIds: next,
      selectedAgentId: null,
      sessionFilterInitialized: true,
    });
  },

  // Single-session pick from the TopBar selector. Like toggleSession but
  // replaces the whole filter with just this id (and never opens the detail
  // panel — selecting a session is a topology-filter action, not agent pick).
  selectOnlySession: (sessionId) => {
    const next = new Set<string>([sessionId]);
    persistSessionFilter(next);
    set({
      selectedSessionIds: next,
      selectedAgentId: null,
      sessionFilterInitialized: true,
    });
  },

  selectAllSessions: () => {
    const empty = new Set<string>();
    persistSessionFilter(empty);
    set({
      selectedSessionIds: empty,
      selectedAgentId: null,
      sessionFilterInitialized: true,
    });
  },

  autoSelectInitialSession: () => {
    const { agents, selectedSessionIds, sessionFilterInitialized } = get();
    if (sessionFilterInitialized) return;

    // Collect every session id currently represented by a parentless agent —
    // these are the only ids that can match a stored filter.
    const liveSessionIds = new Set<string>();
    for (const a of agents.values()) {
      if (a.parentId) continue;
      liveSessionIds.add(resolveSessionId(a, agents));
    }

    // Hydration restored a prior selection — but only honor it if at least
    // one of the stored ids still matches a live session. A stale filter
    // (e.g. the upstream session id changed between runs) would otherwise hide
    // every agent forever; falling through to "All Sessions" is much better.
    if (selectedSessionIds.size > 0) {
      let anyLive = false;
      for (const id of selectedSessionIds) {
        if (liveSessionIds.has(id)) {
          anyLive = true;
          break;
        }
      }
      if (anyLive) {
        set({ sessionFilterInitialized: true });
        return;
      }
      // No matches — wait for agents to arrive before discarding the stored
      // filter. If the WS sync just hasn't landed yet, the filter may still
      // be valid. Only drop it once we have agents but no overlap.
      if (liveSessionIds.size === 0) {
        console.warn(
          "[uiSlice] Stored session filter does not match any live session; waiting for a main agent to register.",
          { stored: [...selectedSessionIds] },
        );
        return;
      }
      // Fall through: we have live sessions but none match the stored ids.
      console.warn(
        "[uiSlice] Stored session filter is stale; defaulting to All Sessions.",
        { stale: [...selectedSessionIds], live: [...liveSessionIds] },
      );
    }

    // Default: show ALL sessions. Wait until at least one live session exists
    // before flipping `sessionFilterInitialized`, so this effect re-runs once
    // agents arrive (otherwise an empty boot would freeze the flag prematurely).
    if (liveSessionIds.size === 0) return;
    const empty = new Set<string>();
    persistSessionFilter(empty);
    set({ selectedSessionIds: empty, sessionFilterInitialized: true });
  },

  selectTeam: (teamId) => set({ selectedTeamId: teamId }),
  selectWorkflow: (runId) => set({ selectedWorkflowId: runId }),

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
  toggleFileAttention: () =>
    set((s) => ({ fileAttentionOpen: !s.fileAttentionOpen })),

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
    saveLocalStorage("theme", next);
    set({ theme: next });
  },

  // ── F12: Graph Layout ─────────────────────────────────
  graphLayout: "force",
  setGraphLayout: (layout) => set({ graphLayout: layout }),

  // ── F14: Session Comparison ───────────────────────────
  comparison: { active: false, leftSession: null, rightSession: null },

  loadComparison: (left, right) =>
    set({
      comparison: { active: true, leftSession: left, rightSession: right },
    }),

  exitComparison: () =>
    set({
      comparison: { active: false, leftSession: null, rightSession: null },
    }),

  // ── Sound ──────────────────────────────────────────
  soundMuted: false, // Hydrated from localStorage on client mount

  toggleSoundMute: () => {
    const next = !get().soundMuted;
    saveLocalStorage("soundMuted", next);
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
      updates.selectedSessionIds = new Set(stored);
      // Empty array = explicit "All sessions" — no validation needed, mark
      // initialized so the auto-pick won't override it.
      // Non-empty arrays must run through autoSelectInitialSession() so it
      // can verify the stored ids still match a live session and recover
      // from a stale filter (stored ids may no longer match a live session).
      if (stored.length === 0) updates.sessionFilterInitialized = true;
    }
    set(updates);
  },
});
