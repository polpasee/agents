import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAgentStore } from "../../store";
import type { Annotation } from "../../types";
import { METRIC_HISTORY_MAX } from "../../config";

beforeEach(() => {
  useAgentStore.setState({
    logEntries: new Map(),
    logLoading: new Set(),
    logViewerAgentId: null,
    agentDiffs: new Map(),
    diffViewerAgentId: null,
    errorDrillDownAgentId: null,
    budgetThreshold: null,
    metricHistory: [],
    annotations: new Map(),
  });
});

// ── Log Viewer ─────────────────────────────────────────────────────────────

describe("openLogViewer / closeLogViewer", () => {
  it("sets logViewerAgentId on open", () => {
    useAgentStore.getState().openLogViewer("agent-1");
    expect(useAgentStore.getState().logViewerAgentId).toBe("agent-1");
  });

  it("clears logViewerAgentId on close", () => {
    useAgentStore.getState().openLogViewer("agent-1");
    useAgentStore.getState().closeLogViewer();
    expect(useAgentStore.getState().logViewerAgentId).toBeNull();
  });
});

describe("setLogEntries", () => {
  it("stores log entries for an agent", () => {
    const entries = [
      { timestamp: 1000, role: "user" as const, content: "hello" },
    ];
    useAgentStore.getState().setLogEntries("a1", entries);
    expect(useAgentStore.getState().logEntries.get("a1")).toEqual(entries);
  });

  it("removes the agent from logLoading after setting entries", () => {
    useAgentStore.setState({ logLoading: new Set(["a1"]) });
    useAgentStore.getState().setLogEntries("a1", []);
    expect(useAgentStore.getState().logLoading.has("a1")).toBe(false);
  });

  it("preserves entries for other agents", () => {
    const entries1 = [{ timestamp: 1, role: "user" as const, content: "a" }];
    const entries2 = [
      { timestamp: 2, role: "assistant" as const, content: "b" },
    ];
    useAgentStore.getState().setLogEntries("a1", entries1);
    useAgentStore.getState().setLogEntries("a2", entries2);
    expect(useAgentStore.getState().logEntries.get("a1")).toEqual(entries1);
    expect(useAgentStore.getState().logEntries.get("a2")).toEqual(entries2);
  });
});

describe("setLogLoading", () => {
  it("adds agent to logLoading when loading=true", () => {
    useAgentStore.getState().setLogLoading("a1", true);
    expect(useAgentStore.getState().logLoading.has("a1")).toBe(true);
  });

  it("removes agent from logLoading when loading=false", () => {
    useAgentStore.setState({ logLoading: new Set(["a1"]) });
    useAgentStore.getState().setLogLoading("a1", false);
    expect(useAgentStore.getState().logLoading.has("a1")).toBe(false);
  });

  it("tracks multiple agents independently", () => {
    useAgentStore.getState().setLogLoading("a1", true);
    useAgentStore.getState().setLogLoading("a2", true);
    useAgentStore.getState().setLogLoading("a1", false);
    const { logLoading } = useAgentStore.getState();
    expect(logLoading.has("a1")).toBe(false);
    expect(logLoading.has("a2")).toBe(true);
  });
});

// ── Error Drill-Down ───────────────────────────────────────────────────────

describe("openErrorDrillDown / closeErrorDrillDown", () => {
  it("sets errorDrillDownAgentId", () => {
    useAgentStore.getState().openErrorDrillDown("err-agent");
    expect(useAgentStore.getState().errorDrillDownAgentId).toBe("err-agent");
  });

  it("clears errorDrillDownAgentId on close", () => {
    useAgentStore.getState().openErrorDrillDown("err-agent");
    useAgentStore.getState().closeErrorDrillDown();
    expect(useAgentStore.getState().errorDrillDownAgentId).toBeNull();
  });
});

// ── Metric History ─────────────────────────────────────────────────────────

describe("pushMetricSample", () => {
  it("appends a metric sample", () => {
    const sample = {
      timestamp: 1000,
      tokensPerSec: 10,
      costPerMin: 0.01,
      activeCount: 2,
      totalCost: 0.5,
      totalTokens: 500,
    };
    useAgentStore.getState().pushMetricSample(sample);
    expect(useAgentStore.getState().metricHistory).toHaveLength(1);
    expect(useAgentStore.getState().metricHistory[0]).toEqual(sample);
  });

  it("caps history at METRIC_HISTORY_MAX", () => {
    for (let i = 0; i < METRIC_HISTORY_MAX + 5; i++) {
      useAgentStore.getState().pushMetricSample({
        timestamp: i,
        tokensPerSec: i,
        costPerMin: 0,
        activeCount: 0,
        totalCost: 0,
        totalTokens: 0,
      });
    }
    expect(useAgentStore.getState().metricHistory).toHaveLength(
      METRIC_HISTORY_MAX,
    );
    // most recent sample should be the last one
    const last =
      useAgentStore.getState().metricHistory[METRIC_HISTORY_MAX - 1]!;
    expect(last.timestamp).toBe(METRIC_HISTORY_MAX + 4);
  });
});

// ── Annotations ────────────────────────────────────────────────────────────

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    targetId: "agent-1",
    targetType: "agent",
    text: "test note",
    timestamp: 1000,
    ...overrides,
  };
}

describe("addAnnotation", () => {
  it("adds an annotation to the map", () => {
    const ann = makeAnnotation({ id: "ann-1" });
    useAgentStore.getState().addAnnotation(ann);
    expect(useAgentStore.getState().annotations.get("ann-1")).toEqual(ann);
  });

  it("can store multiple annotations", () => {
    useAgentStore.getState().addAnnotation(makeAnnotation({ id: "ann-1" }));
    useAgentStore.getState().addAnnotation(makeAnnotation({ id: "ann-2" }));
    expect(useAgentStore.getState().annotations.size).toBe(2);
  });
});

describe("removeAnnotation", () => {
  it("removes an annotation by id", () => {
    useAgentStore.getState().addAnnotation(makeAnnotation({ id: "ann-1" }));
    useAgentStore.getState().removeAnnotation("ann-1");
    expect(useAgentStore.getState().annotations.has("ann-1")).toBe(false);
  });

  it("is a no-op for a non-existent id", () => {
    useAgentStore.getState().removeAnnotation("nonexistent");
    expect(useAgentStore.getState().annotations.size).toBe(0);
  });
});

describe("updateAnnotation", () => {
  it("merges updates into an existing annotation", () => {
    useAgentStore
      .getState()
      .addAnnotation(makeAnnotation({ id: "ann-1", text: "original" }));
    useAgentStore.getState().updateAnnotation("ann-1", { text: "updated" });
    expect(useAgentStore.getState().annotations.get("ann-1")?.text).toBe(
      "updated",
    );
  });

  it("does not modify other fields on update", () => {
    const ann = makeAnnotation({
      id: "ann-1",
      text: "original",
      targetId: "a1",
    });
    useAgentStore.getState().addAnnotation(ann);
    useAgentStore.getState().updateAnnotation("ann-1", { text: "new text" });
    expect(useAgentStore.getState().annotations.get("ann-1")?.targetId).toBe(
      "a1",
    );
  });

  it("is a no-op for a non-existent id", () => {
    // Should not throw
    useAgentStore.getState().updateAnnotation("missing", { text: "x" });
    expect(useAgentStore.getState().annotations.size).toBe(0);
  });
});

describe("replaceAnnotations", () => {
  it("replaces all annotations with the new list", () => {
    useAgentStore.getState().addAnnotation(makeAnnotation({ id: "old-1" }));
    useAgentStore
      .getState()
      .replaceAnnotations([
        makeAnnotation({ id: "new-1" }),
        makeAnnotation({ id: "new-2" }),
      ]);
    const { annotations } = useAgentStore.getState();
    expect(annotations.has("old-1")).toBe(false);
    expect(annotations.has("new-1")).toBe(true);
    expect(annotations.has("new-2")).toBe(true);
  });

  it("clears all annotations when passed an empty array", () => {
    useAgentStore.getState().addAnnotation(makeAnnotation({ id: "ann-1" }));
    useAgentStore.getState().replaceAnnotations([]);
    expect(useAgentStore.getState().annotations.size).toBe(0);
  });
});

// ── Diff Viewer ────────────────────────────────────────────────────────────

describe("openDiffViewer / closeDiffViewer", () => {
  it("sets diffViewerAgentId on open", () => {
    useAgentStore.getState().openDiffViewer("diff-agent");
    expect(useAgentStore.getState().diffViewerAgentId).toBe("diff-agent");
  });

  it("clears diffViewerAgentId on close", () => {
    useAgentStore.getState().openDiffViewer("diff-agent");
    useAgentStore.getState().closeDiffViewer();
    expect(useAgentStore.getState().diffViewerAgentId).toBeNull();
  });
});

describe("setAgentDiffs", () => {
  it("stores diffs for an agent", () => {
    const diffs = [
      {
        filePath: "/src/foo.ts",
        operation: "edit" as const,
        diff: "- old\n+ new",
        timestamp: 1000,
      },
    ];
    useAgentStore.getState().setAgentDiffs("a1", diffs);
    expect(useAgentStore.getState().agentDiffs.get("a1")).toEqual(diffs);
  });

  it("preserves diffs for other agents", () => {
    useAgentStore.getState().setAgentDiffs("a1", []);
    useAgentStore
      .getState()
      .setAgentDiffs("a2", [
        { filePath: "/b.ts", operation: "create" as const, timestamp: 1 },
      ]);
    expect(useAgentStore.getState().agentDiffs.has("a1")).toBe(true);
    expect(useAgentStore.getState().agentDiffs.has("a2")).toBe(true);
  });
});

// ── Budget Threshold ───────────────────────────────────────────────────────

describe("setBudgetThreshold", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets the budget threshold", () => {
    useAgentStore.getState().setBudgetThreshold(100);
    expect(useAgentStore.getState().budgetThreshold).toBe(100);
  });

  it("clears the threshold when null is passed", () => {
    useAgentStore.getState().setBudgetThreshold(100);
    useAgentStore.getState().setBudgetThreshold(null);
    expect(useAgentStore.getState().budgetThreshold).toBeNull();
  });
});
