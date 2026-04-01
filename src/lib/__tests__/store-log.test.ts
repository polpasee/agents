import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../store";
import type { LogEntry } from "../types";

beforeEach(() => {
  useAgentStore.setState({
    logEntries: new Map(),
    logLoading: new Set(),
    logViewerAgentId: null,
  });
});

describe("openLogViewer", () => {
  it("sets logViewerAgentId", () => {
    useAgentStore.getState().openLogViewer("agent-1");
    expect(useAgentStore.getState().logViewerAgentId).toBe("agent-1");
  });

  it("overwrites previously set logViewerAgentId", () => {
    useAgentStore.getState().openLogViewer("agent-1");
    useAgentStore.getState().openLogViewer("agent-2");
    expect(useAgentStore.getState().logViewerAgentId).toBe("agent-2");
  });
});

describe("closeLogViewer", () => {
  it("clears logViewerAgentId", () => {
    useAgentStore.getState().openLogViewer("agent-1");
    expect(useAgentStore.getState().logViewerAgentId).toBe("agent-1");

    useAgentStore.getState().closeLogViewer();
    expect(useAgentStore.getState().logViewerAgentId).toBeNull();
  });
});

describe("setLogEntries", () => {
  it("stores entries for the given agent", () => {
    const entries: LogEntry[] = [
      { timestamp: 1000, role: "user", content: "Hello" },
      { timestamp: 2000, role: "assistant", content: "Hi there" },
    ];

    useAgentStore.getState().setLogEntries("agent-1", entries);

    const stored = useAgentStore.getState().logEntries.get("agent-1");
    expect(stored).toEqual(entries);
  });

  it("removes agent from logLoading set", () => {
    useAgentStore.getState().setLogLoading("agent-1", true);
    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(true);

    const entries: LogEntry[] = [
      { timestamp: 1000, role: "system", content: "System message" },
    ];
    useAgentStore.getState().setLogEntries("agent-1", entries);

    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(false);
  });

  it("can store entries for multiple agents", () => {
    const entries1: LogEntry[] = [{ timestamp: 1000, role: "user", content: "A" }];
    const entries2: LogEntry[] = [{ timestamp: 2000, role: "assistant", content: "B" }];

    useAgentStore.getState().setLogEntries("agent-1", entries1);
    useAgentStore.getState().setLogEntries("agent-2", entries2);

    expect(useAgentStore.getState().logEntries.get("agent-1")).toEqual(entries1);
    expect(useAgentStore.getState().logEntries.get("agent-2")).toEqual(entries2);
  });
});

describe("setLogLoading", () => {
  it("adds agent to logLoading when loading=true", () => {
    useAgentStore.getState().setLogLoading("agent-1", true);
    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(true);
  });

  it("removes agent from logLoading when loading=false", () => {
    useAgentStore.getState().setLogLoading("agent-1", true);
    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(true);

    useAgentStore.getState().setLogLoading("agent-1", false);
    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(false);
  });

  it("handles multiple agents in logLoading", () => {
    useAgentStore.getState().setLogLoading("agent-1", true);
    useAgentStore.getState().setLogLoading("agent-2", true);

    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(true);
    expect(useAgentStore.getState().logLoading.has("agent-2")).toBe(true);

    useAgentStore.getState().setLogLoading("agent-1", false);
    expect(useAgentStore.getState().logLoading.has("agent-1")).toBe(false);
    expect(useAgentStore.getState().logLoading.has("agent-2")).toBe(true);
  });
});
