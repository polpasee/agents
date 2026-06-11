import { create } from "zustand";
import type { AgentStore } from "./types";
import { createAgentSlice } from "./agentSlice";
import { createUISlice } from "./uiSlice";
import { createReplaySlice } from "./replaySlice";
import { createPanelSlice } from "./panelSlice";

export const useAgentStore = create<AgentStore>((...a) => ({
  ...createAgentSlice(...a),
  ...createUISlice(...a),
  ...createReplaySlice(...a),
  ...createPanelSlice(...a),
}));
