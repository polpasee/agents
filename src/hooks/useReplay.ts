"use client";
import { useEffect, useRef } from "react";
import { useAgentStore } from "@/lib/store";
import { REPLAY_TICK_MS } from "@/lib/config";

export function useReplay() {
  const playing = useAgentStore((s) => s.replay.playing);
  const active = useAgentStore((s) => s.replay.active);
  const speed = useAgentStore((s) => s.replay.speed);
  const endTime = useAgentStore((s) => s.replay.endTime);
  const replayTick = useAgentStore((s) => s.replayTick);
  const replayPause = useAgentStore((s) => s.replayPause);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!active || !playing) return;

    function tick() {
      const { replay } = useAgentStore.getState();
      if (!replay.playing || !replay.session) return;
      const advance = REPLAY_TICK_MS * replay.speed;
      const newTime = Math.min(replay.currentTime + advance, replay.endTime);
      replayTick(newTime);
      if (newTime >= replay.endTime) {
        replayPause();
      } else {
        timerRef.current = setTimeout(tick, REPLAY_TICK_MS);
      }
    }

    timerRef.current = setTimeout(tick, REPLAY_TICK_MS);
    return () => { clearTimeout(timerRef.current); };
  }, [active, playing, speed, endTime, replayTick, replayPause]);
}
