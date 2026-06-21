import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { THINKING_EFFORTS, type ThinkingEffort } from "../../src/lib/types";

// ---------------------------------------------------------------------------
// Per-pass settings.json cache — avoids re-reading the same file for every
// agent registered during a single discovery run.
// ---------------------------------------------------------------------------

export type ParsedSettings = Record<string, unknown> | null;
export type SettingsCache = Map<string, ParsedSettings>;

export function readSettingsCached(
  filePath: string,
  cache: SettingsCache,
): ParsedSettings {
  if (cache.has(filePath)) return cache.get(filePath)!;
  let result: ParsedSettings = null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    result =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to read settings ${filePath}:`, err);
    }
  }
  cache.set(filePath, result);
  return result;
}

export function settingsCandidatePaths(projectDir: string): string[] {
  return [
    path.join(projectDir, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
}

export function readEffortLevelCached(
  projectDir: string,
  cache: SettingsCache,
): ThinkingEffort | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const value = parsed?.effortLevel;
    if (
      typeof value === "string" &&
      (THINKING_EFFORTS as readonly string[]).includes(value)
    ) {
      return value as ThinkingEffort;
    }
  }
  return undefined;
}

export function readIs1MContextCached(
  projectDir: string,
  cache: SettingsCache,
): boolean | undefined {
  for (const filePath of settingsCandidatePaths(projectDir)) {
    const parsed = readSettingsCached(filePath, cache);
    const model = parsed?.model;
    if (typeof model === "string") return /\[1m\]/i.test(model);
  }
  return undefined;
}
