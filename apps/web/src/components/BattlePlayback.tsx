import { useEffect, useRef, useState } from 'react';
import { TICK_S, type BattleReport } from '@mechbattler/sim';
import { fmtTime } from '../lib/battleText.js';
import { BattleCaption, BattleScene, BattleTicker } from './BattleHud.js';
import './BattlePlayback.css';

/**
 * Replay player over a finished battle report: the shared scene (BattleHud)
 * plus scrubbable transport controls. The live mode (BattleLiveScreen) renders
 * the same scene from a running battle.
 */

const SPEEDS = [1, 2, 4, 8] as const;

export function BattlePlayback({ report, names }: { report: BattleReport; names: [string, string] }) {
  const [tSec, setTSec] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const tRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25) * speed;
      last = now;
      tRef.current = Math.min(tRef.current + dt, report.durationS);
      setTSec(tRef.current);
      if (tRef.current >= report.durationS) { setPlaying(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, report.durationS]);

  const seek = (t: number) => {
    tRef.current = t;
    setTSec(t);
  };

  return (
    <div className="playback">
      <BattleScene view={report} tSec={tSec} names={names} />

      <div className="playback-controls">
        <button
          type="button" className="playback-btn"
          onClick={() => {
            if (!playing && tSec >= report.durationS) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? '❚❚' : tSec >= report.durationS ? '↻' : '▶'}
        </button>
        <button type="button" className="playback-btn" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}>
          {speed}×
        </button>
        <input
          type="range" className="playback-scrub"
          min={0} max={report.durationS} step={TICK_S} value={tSec}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="playback-clock">{fmtTime(tSec)} / {fmtTime(report.durationS)}</span>
      </div>

      <BattleTicker view={report} tSec={tSec} names={names} />
      <BattleCaption view={report} />
    </div>
  );
}
