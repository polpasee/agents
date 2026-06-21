import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        ".next/**",
        "v2/**",
        "**/__tests__/**",
        "**/*.config.{ts,mjs,js}",
        "src/app/layout.tsx",
        "scripts/mock-agents.ts",
      ],
      thresholds: {
        // ── Global aggregate floors ──────────────────────────────────────────
        // Applied to the whole codebase total (not per-file).
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,

        // ── Explicit per-file floors (glob-based) ────────────────────────────
        // These lock in minimum coverage for the most important files so a
        // regression in a single file can't hide behind healthy aggregate numbers.
        // Inherently hard-to-cover files (D3 physics, canvas RAF loop, network
        // SSE hooks) get lower floors that still catch total coverage collapses.

        // Core topology hook — tick interior now partially covered.
        "src/components/AgentGraph/useTopologyEffect.ts": {
          lines: 55,
          branches: 45,
          functions: 50,
          statements: 55,
        },
        // Node-visuals effect — particle emission now covered.
        "src/components/AgentGraph/useNodeVisualsEffect.ts": {
          lines: 70,
          branches: 55,
          functions: 70,
          statements: 70,
        },
        // MiniMap canvas — draw loop now covered via RAF stub.
        "src/components/MiniMap.tsx": {
          lines: 20,
          branches: 20,
          functions: 20,
          statements: 20,
        },
        // AgentList / AgentDetail — complex UI components, well-covered.
        "src/components/AgentList.tsx": {
          lines: 75,
          branches: 55,
          functions: 75,
          statements: 75,
        },
        "src/components/AgentDetail.tsx": {
          lines: 75,
          branches: 55,
          functions: 75,
          statements: 75,
        },
        // Lifecycle animation layer — RAF-coupled branches.
        "src/components/AgentGraph/useLifecycleEffectsLayer.ts": {
          lines: 60,
          branches: 55,
          functions: 60,
          statements: 60,
        },
        // Tool-nodes effect — simulation coupling limits testability.
        "src/components/AgentGraph/useToolNodesEffect.ts": {
          lines: 65,
          branches: 50,
          functions: 65,
          statements: 65,
        },
        // High-value lib code — lock in solid coverage floors.
        "src/lib/store/agentSlice.ts": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/lib/d3/heatmap.ts": {
          lines: 65,
          branches: 60,
          functions: 65,
          statements: 65,
        },
        "src/lib/d3/updateLinks.ts": {
          lines: 85,
          branches: 60,
          functions: 70,
          statements: 85,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
