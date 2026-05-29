import { describe, it, expect } from "vitest";
import type { ActivityEntry } from "@/lib/types";

/**
 * Unit tests for the id-tracking logic extracted from useLifecycleEffectsLayer.
 *
 * The fix replaces `activity.slice(prevLenRef)` (broken after the array is
 * capped at ACTIVITY_MAX_ENTRIES) with a filter on the monotonic numeric id
 * embedded in each entry's string id ("act-N").
 */

/** Mirrors the helper inline in useLifecycleEffectsLayer */
function activityNumId(e: ActivityEntry): number {
  return parseInt(e.id.replace("act-", ""), 10);
}

/** Mirrors the new-entries filtering logic in useLifecycleEffectsLayer */
function getNewEntries(activity: ActivityEntry[], lastSeenId: number): ActivityEntry[] {
  return activity.filter((e) => activityNumId(e) > lastSeenId);
}

function makeEntry(numId: number, type: "agent:register" | "agent:complete" = "agent:register"): ActivityEntry {
  return {
    id: `act-${numId}`,
    timestamp: numId * 100,
    event: { type, agentId: "a1" } as ActivityEntry["event"],
  };
}

describe("useLifecycleEffectsLayer — id-tracking logic", () => {
  it("returns all entries when lastSeenId is -1 (initial state)", () => {
    const activity = [makeEntry(1), makeEntry(2), makeEntry(3)];
    expect(getNewEntries(activity, -1)).toHaveLength(3);
  });

  it("returns only the entry that is strictly newer than lastSeenId", () => {
    const activity = [makeEntry(5), makeEntry(6), makeEntry(7)];
    const newEntries = getNewEntries(activity, 6);
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0].id).toBe("act-7");
  });

  it("returns empty array when no entry is newer than lastSeenId", () => {
    const activity = [makeEntry(10), makeEntry(11), makeEntry(12)];
    expect(getNewEntries(activity, 12)).toHaveLength(0);
  });

  it("handles the capped/evicted scenario correctly (ids continue past the cap)", () => {
    // Simulate ACTIVITY_MAX_ENTRIES = 5. The array is capped at ids 96–100.
    // A new event arrives with id 101; the array slides to 97–101.
    // lastSeenId = 100 (last processed before saturation).
    const activity = [makeEntry(97), makeEntry(98), makeEntry(99), makeEntry(100), makeEntry(101)];
    const newEntries = getNewEntries(activity, 100);

    // Only entry 101 is new — the old slice(5) would have returned []
    expect(newEntries).toHaveLength(1);
    expect(newEntries[0].id).toBe("act-101");
  });

  it("with length-based slice approach (the OLD bug): demonstrates it returns [] after cap", () => {
    // This documents the bug: once the array is saturated at length 5,
    // activity.slice(5) is always [] regardless of what was evicted.
    const cap = 5;
    const activity = [makeEntry(97), makeEntry(98), makeEntry(99), makeEntry(100), makeEntry(101)];
    // prevActivityLenRef.current was set to 5 when array first hit cap
    const buggySlice = activity.slice(cap);
    expect(buggySlice).toHaveLength(0); // ← demonstrates the bug
  });

  it("advances lastSeenId to the last entry's numeric id", () => {
    const activity = [makeEntry(20), makeEntry(21), makeEntry(22)];
    const lastEntry = activity[activity.length - 1];
    const newLastSeenId = activityNumId(lastEntry);
    expect(newLastSeenId).toBe(22);
  });
});
