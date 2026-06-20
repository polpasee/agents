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
        lines: 80,
        functions: 82,
        branches: 72,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
