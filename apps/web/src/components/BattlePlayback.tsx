import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getChassis, CELL_SIZE_M, CORE_HP, TICK_S,
  type BattleEvent, type BattleReport, type MechFrame,
} from '@mechbattler/sim';
import { eventText, fmtTime } from '../lib/battleText.js';
import './BattlePlayback.css';

/**
 * Replay player over the battle report's frame + event log. Renders nothing
 * the sim didn't record (rule R6: presentation is a playback layer) — mech
 * poses come from frames, tracers and flashes from shot events, and the
 * ticker narrates the order stream so the four verbs stay visible.
 */

/** True footprints are ~3 m in a 200 m arena; magnify them to stay readable. */
const MECH_MAG = 5;
const TRACER_LINGER_S = 0.22;
const FLASH_LINGER_S = 0.4;
const MECH_COLORS = ['var(--signal-blue)', 'var(--signal-red)'] as const;
const SPEEDS = [1, 2, 4, 8] as const;

function frameAt(report: BattleReport, tSec: number) {
  const idx = Math.min(report.frames.length - 1, Math.max(0, Math.round(tSec / TICK_S) - 1));
  return report.frames[idx];
}

function MechGlyph({ frame, chassisId, color }: { frame: MechFrame; chassisId: string; color: string }) {
  const chassis = getChassis(chassisId);
  // Grid "up" is forward, and forward points along +x at facing 0: the
  // footprint's grid-height runs along the facing axis.
  const lenM = chassis.height * CELL_SIZE_M * MECH_MAG;
  const widM = chassis.width * CELL_SIZE_M * MECH_MAG;
  const deg = (frame.facingRad * 180) / Math.PI;
  return (
    <g transform={`translate(${frame.x} ${frame.y}) rotate(${deg})`}>
      <rect
        x={-lenM / 2} y={-widM / 2} width={lenM} height={widM}
        rx={1.5} fill={color} opacity={0.28} stroke={color} strokeWidth={0.8}
      />
      <path d={`M ${lenM / 2 + 3} 0 L ${lenM / 2 - 1} -2.4 L ${lenM / 2 - 1} 2.4 Z`} fill={color} />
    </g>
  );
}

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

  const frame = frameAt(report, tSec);

  // Shots fired just before `tSec` become tracers; hits also flash the target.
  const tracers = useMemo(
    () => report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'shot' }> =>
        e.type === 'shot' && e.tSec <= tSec && e.tSec > tSec - TRACER_LINGER_S,
    ),
    [report.events, tSec],
  );
  const flashes = useMemo(
    () => report.events.filter(
      (e) => (e.type === 'part-destroyed' || e.type === 'cookoff') && e.tSec <= tSec && e.tSec > tSec - FLASH_LINGER_S,
    ),
    [report.events, tSec],
  );

  // Ticker: decisions and consequences up to now (routine shots stay out).
  const tickerRows = useMemo(() => {
    const rows = report.events.filter((e) => {
      if (e.tSec > tSec) return false;
      if (e.type === 'shot') return e.hit && e.totalDamageDealt >= 15;
      return true;
    });
    return rows.slice(-7);
  }, [report.events, tSec]);

  const halfL = report.arena.lengthM / 2;
  const halfW = report.arena.widthM / 2;
  const margin = 8;

  if (!frame) return null;

  return (
    <div className="playback">
      <div className="playback-status">
        {([0, 1] as const).map((i) => {
          const m = frame.mechs[i];
          return (
            <div key={i} className="playback-mech-status" style={{ borderColor: MECH_COLORS[i] }}>
              <span className="playback-mech-name" style={{ color: MECH_COLORS[i] }}>{names[i]}</span>
              <span className="playback-meter" title="Core HP">
                <span className="playback-meter-fill core" style={{ width: `${(100 * Math.max(0, m.coreHp)) / CORE_HP}%` }} />
              </span>
              <span className="playback-meter" title="Functional mass">
                <span className="playback-meter-fill mass" style={{ width: `${100 * m.functionalMassFrac}%` }} />
              </span>
              <span className="playback-throttle">{m.speedSetting}</span>
            </div>
          );
        })}
      </div>

      <svg
        className="playback-arena"
        viewBox={`${-halfL - margin} ${-halfW - margin} ${2 * (halfL + margin)} ${2 * (halfW + margin)}`}
      >
        <rect x={-halfL} y={-halfW} width={2 * halfL} height={2 * halfW} className="playback-walls" />
        {Array.from({ length: Math.floor(halfL / 25) * 2 + 1 }, (_, k) => (k - Math.floor(halfL / 25)) * 25).map((x) => (
          <line key={x} x1={x} y1={-halfW} x2={x} y2={halfW} className="playback-gridline" />
        ))}

        {tracers.map((e, idx) => {
          const f = frameAt(report, e.tSec);
          if (!f) return null;
          const from = f.mechs[e.mech];
          const to = f.mechs[(1 - e.mech) as 0 | 1];
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const d = Math.hypot(dx, dy) || 1;
          // Misses streak past the target, offset sideways (visual only; the
          // sim resolved the miss statistically).
          const missOff = e.hit ? 0 : ((idx % 2 === 0 ? 1 : -1) * (4 + (idx % 3) * 2));
          const ex = e.hit ? to.x : to.x + (dx / d) * 18 - (dy / d) * missOff;
          const ey = e.hit ? to.y : to.y + (dy / d) * 18 + (dx / d) * missOff;
          const age = (tSec - e.tSec) / TRACER_LINGER_S;
          return (
            <g key={`tr${idx}`} opacity={1 - age * 0.8}>
              <line x1={from.x} y1={from.y} x2={ex} y2={ey} className={`playback-tracer${e.hit ? ' hit' : ''}`} stroke={MECH_COLORS[e.mech]} />
              {e.hit && <circle cx={to.x} cy={to.y} r={1.6 + age * 2.5} className="playback-impact" />}
            </g>
          );
        })}

        {flashes.map((e, idx) => {
          if (e.type !== 'part-destroyed' && e.type !== 'cookoff') return null;
          const f = frameAt(report, e.tSec);
          if (!f) return null;
          const m = f.mechs[e.mech];
          const age = (tSec - e.tSec) / FLASH_LINGER_S;
          return <circle key={`fl${idx}`} cx={m.x} cy={m.y} r={3 + age * 8} className="playback-boom" opacity={1 - age} />;
        })}

        {([0, 1] as const).map((i) => (
          <MechGlyph key={i} frame={frame.mechs[i]} chassisId={report.mechs[i].chassisId} color={MECH_COLORS[i]} />
        ))}
      </svg>

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

      <div className="playback-ticker">
        {tickerRows.map((e, idx) => {
          const { text, cls } = eventText(e, names);
          return (
            <div key={`${e.tSec}-${idx}`} className={`playback-ticker-row ${cls}`}>
              <span className="playback-ticker-time">{fmtTime(e.tSec)}</span>
              <span>{text}</span>
            </div>
          );
        })}
      </div>

      <div className="playback-caption">mech footprints magnified {MECH_MAG}× · arena {report.arena.lengthM} × {report.arena.widthM} m</div>
    </div>
  );
}
