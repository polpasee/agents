"use client";

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContext();
  }
  if (sharedCtx.state === "suspended") {
    sharedCtx.resume();
  }
  return sharedCtx;
}

function playClick(freq: number) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    gain.gain.value = 0.06;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
    osc.start();
    osc.stop(ctx.currentTime + 0.025);
  } catch { /* AudioContext not available */ }
}

function playSpawnShimmer() {
  try {
    const ctx = getCtx();
    const notes = [784, 1175]; // G5, D6 — rising fifth
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + i * 0.06;
      gain.gain.setValueAtTime(0.04, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch { /* AudioContext not available */ }
}

function playCompleteArpeggio() {
  try {
    const ctx = getCtx();
    const notes = [262, 330, 392, 494]; // C4, E4, G4, B4 — Cmaj7
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.05, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch { /* AudioContext not available */ }
}

function playErrorTone() {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(165, ctx.currentTime + 0.25);
    gain.gain.value = 0.06;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
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
        case "agent:register":
          playSpawnShimmer();
          break;
        case "agent:complete":
          playCompleteArpeggio();
          break;
        case "agent:tool_call":
          playClick(480);
          break;
        case "agent:status":
          if ("status" in entry.event && entry.event.status === "error") {
            playErrorTone();
          }
          break;
      }
    }
  }, [activity]);
}
