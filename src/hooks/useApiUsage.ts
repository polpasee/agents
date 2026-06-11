"use client";

import { useEffect, useState } from "react";

/**
 * Shared singleton poller for /api/usage. Both UsagePanel and
 * TopologyUsageStatus consume the same usage figures; without dedup each
 * component would mount its own poll loop. Centralizing here means one
 * request per cycle regardless of how many consumers are mounted.
 *
 * Cadence: 30s matches the server's USAGE_REFRESH_INTERVAL_MS — the
 * upstream ccstatusline cache only ever refreshes that fast, so polling
 * more aggressively buys nothing.
 */

export interface ApiUsage {
  blockPercent: number | null;
  weeklyPercent: number | null;
  blockResetAt: string | null;
  weeklyResetAt: string | null;
  ageMs?: number | null;
  stale?: boolean;
}

export interface ApiUsageState {
  data: ApiUsage | null;
  error: boolean;
}

const POLL_MS = 30_000;

const subscribers = new Set<(state: ApiUsageState) => void>();
let current: ApiUsageState = { data: null, error: false };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

function notify(): void {
  for (const fn of subscribers) fn(current);
}

async function fetchOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await fetch("/api/usage");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as ApiUsage | null;
      // null payload = upstream cache missing entirely; treat as no-data
      // rather than an error so we keep the "Usage data unavailable"
      // path distinct from a transient network failure.
      current = { data, error: false };
    } catch {
      current = { ...current, error: true };
    } finally {
      notify();
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

function ensurePolling(): void {
  if (timer !== null) return;
  // Fire one immediately so a freshly mounted consumer doesn't wait 30s
  // for its first value.
  void fetchOnce();
  timer = setInterval(() => { void fetchOnce(); }, POLL_MS);
}

function maybeStopPolling(): void {
  if (subscribers.size > 0 || timer === null) return;
  clearInterval(timer);
  timer = null;
}

export function useApiUsage(): ApiUsageState {
  const [state, setState] = useState<ApiUsageState>(current);
  useEffect(() => {
    subscribers.add(setState);
    // Sync state in case the singleton has data from a prior mount.
    setState(current);
    ensurePolling();
    return () => {
      subscribers.delete(setState);
      maybeStopPolling();
    };
  }, []);
  return state;
}
