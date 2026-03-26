"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";

function playTone(frequency: number, duration: number, volume = 0.1) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = "sine";
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* AudioContext not available */ }
}

export function useSoundNotifications() {
  const activity = useAgentStore((s) => s.activity);
  const prevLenRef = useRef(activity.length);

  useEffect(() => {
    if (activity.length <= prevLenRef.current) {
      prevLenRef.current = activity.length;
      return;
    }

    const newEntries = activity.slice(prevLenRef.current);
    prevLenRef.current = activity.length;

    for (const entry of newEntries) {
      switch (entry.event.type) {
        case "agent:complete":
          playTone(880, 0.3, 0.08);
          break;
        case "agent:register":
          playTone(523, 0.15, 0.05);
          break;
      }
    }
  }, [activity]);
}
