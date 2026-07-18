import { useEffect, useRef, useState } from 'react';
import { TICK_S, type Battle } from '@mechbattler/sim';

/**
 * Steps a running Battle in real time on a requestAnimationFrame accumulator:
 * 20 sim ticks per second × `speed`, pausable (docs/08 §3 — tactical pause is
 * allowed; the autopilot gets its 4 Hz regardless, so pausing is fair). The
 * returned tSec advances with the sim clock and drives the shared scene.
 */
export function useBattle(battle: Battle, { paused, speed }: { paused: boolean; speed: number }) {
  const [tSec, setTSec] = useState(battle.timeS);
  const accRef = useRef(0);

  useEffect(() => {
    if (paused || battle.finished) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Cap the catch-up so a background tab doesn't fast-forward the fight.
      const dt = Math.min((now - last) / 1000, 0.25) * speed;
      last = now;
      accRef.current += dt;
      while (accRef.current >= TICK_S && !battle.finished) {
        accRef.current -= TICK_S;
        battle.step();
      }
      setTSec(battle.timeS);
      if (!battle.finished) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [battle, paused, speed]);

  return { tSec, finished: battle.finished };
}
