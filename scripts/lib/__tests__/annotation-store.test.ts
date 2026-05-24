import { describe, it, expect, beforeEach } from "vitest";
import { annotations, sanitizeAnnotation } from "../annotation-store";
import { ANNOTATION_MAX_ENTRIES, ANNOTATION_MAX_TEXT_LENGTH } from "../config";

describe("annotation-store", () => {
  beforeEach(() => { annotations.clear(); });

  it("accepts a well-formed annotation", () => {
    const out = sanitizeAnnotation({
      id: "ann-abc123",
      targetId: "main-x",
      targetType: "agent",
      text: "hello",
      timestamp: 123,
    });
    expect(out).not.toBeNull();
    expect(out!.id).toBe("ann-abc123");
  });

  it("rejects an annotation with a malformed id", () => {
    expect(sanitizeAnnotation({ id: "bad", targetId: "x", targetType: "agent", text: "y", timestamp: 1 })).toBeNull();
  });

  it("rejects an annotation whose text exceeds the cap", () => {
    expect(sanitizeAnnotation({
      id: "ann-abc",
      targetId: "x",
      targetType: "agent",
      text: "x".repeat(ANNOTATION_MAX_TEXT_LENGTH + 1),
      timestamp: 1,
    })).toBeNull();
  });

  it("rejects an annotation with an unknown targetType", () => {
    expect(sanitizeAnnotation({
      id: "ann-abc", targetId: "x", targetType: "comment", text: "y", timestamp: 1,
    })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(sanitizeAnnotation(null)).toBeNull();
    expect(sanitizeAnnotation("string")).toBeNull();
    expect(sanitizeAnnotation(42)).toBeNull();
  });

  it("shares its Map across module re-imports", async () => {
    annotations.set("ann-hmr", {
      id: "ann-hmr", targetId: "x", targetType: "agent", text: "y", timestamp: 1,
    });
    const reimport = await import("../annotation-store?bust=1");
    expect(reimport.annotations.has("ann-hmr")).toBe(true);
  });

  it("config caps are sane", () => {
    expect(ANNOTATION_MAX_ENTRIES).toBeGreaterThan(0);
    expect(ANNOTATION_MAX_TEXT_LENGTH).toBeGreaterThan(0);
  });
});
