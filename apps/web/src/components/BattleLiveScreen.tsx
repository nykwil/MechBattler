import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autopilotController, buildCapacitorMaxKj, withManualOrders, Battle,
  type Build, type BattleReport, type SpeedSetting, type Vec2,
} from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import { fmtTime } from '../lib/battleText.js';
import { useBattle } from '../state/useBattle.js';
import { BattleCaption, BattleScene, BattleTicker, type BattleView } from './BattleHud.js';
import './BattleReportScreen.css';
import './BattlePlayback.css';
import './BattleLiveScreen.css';

/**
 * Command mode (docs/08): the battle steps live at 20 ticks/s with tactical
 * pause, rendered through the same scene as the replay. The player's standing
 * orders overlay the autopilot per verb (M2: move + throttle — click the
 * arena for a point order, right-click to revert, throttle chips below).
 * When the battle is decided the finished report opens in the report screen.
 */

const LIVE_SPEEDS = [1, 2] as const;
/** Hold the decided battle on screen briefly so the killing blow reads. */
const END_HOLD_S = 1.6;

const THROTTLES: SpeedSetting[] = ['creep', 'cruise', 'flank'];

interface ManualState {
  move: 'auto' | 'hold' | { dest: Vec2 };
  throttle: SpeedSetting | 'auto';
}

const FULL_AUTO: ManualState = { move: 'auto', throttle: 'auto' };

export function BattleLiveScreen({
  build, opponent, seed, onFinished, onAbort,
}: {
  build: Build;
  opponent: OpponentDef;
  seed: number;
  onFinished: (report: BattleReport) => void;
  onAbort: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof LIVE_SPEEDS)[number]>(1);
  const [manual, setManual] = useState<ManualState>(FULL_AUTO);
  // The controller runs inside battle.step() at 4 Hz and reads the ref; state
  // drives the button highlights (docs/08 §3).
  const manualRef = useRef(manual);
  manualRef.current = manual;

  const [battle] = useState(() => new Battle({
    builds: [build, opponent.build],
    seed,
    controllers: [
      withManualOrders(autopilotController, () => {
        const m = manualRef.current;
        return {
          move: m.move === 'auto' ? undefined : m.move,
          throttle: m.throttle === 'auto' ? undefined : m.throttle,
        };
      }),
      autopilotController,
    ],
  }));

  const { tSec, finished } = useBattle(battle, { paused, speed });
  const names: [string, string] = ['YOU', opponent.name.toUpperCase()];

  const view: BattleView = useMemo(() => ({
    frames: battle.frames,
    events: battle.events,
    arena: battle.arena,
    terrain: battle.terrain,
    mechs: [
      { chassisId: battle.combatants[0].build.chassisId, capacitorMaxKj: buildCapacitorMaxKj(battle.combatants[0].build) },
      { chassisId: battle.combatants[1].build.chassisId, capacitorMaxKj: buildCapacitorMaxKj(battle.combatants[1].build) },
    ],
  }), [battle]);

  useEffect(() => {
    if (!finished) return;
    const id = window.setTimeout(() => onFinished(battle.report()), END_HOLD_S * 1000);
    return () => window.clearTimeout(id);
  }, [finished, battle, onFinished]);

  const orderMove = (x: number, y: number, kind: 'move' | 'auto') => {
    if (finished) return;
    if (kind === 'auto') {
      setManual((m) => ({ ...m, move: 'auto' }));
      return;
    }
    const hl = battle.arena.lengthM / 2;
    const hw = battle.arena.widthM / 2;
    const dest = { x: Math.max(-hl, Math.min(hl, x)), y: Math.max(-hw, Math.min(hw, y)) };
    setManual((m) => ({ ...m, move: { dest } }));
  };

  const moveMode = manual.move === 'auto' ? 'auto' : manual.move === 'hold' ? 'hold' : 'waypoint';

  return (
    <div className="report-overlay" role="dialog" aria-modal="true">
      <div className="report-panel">
        <div className="live-topbar">
          <span className="live-dot" />
          <span className="live-title">LIVE · vs {opponent.name} · seed {battle.seed}</span>
          <span className="live-spacer" />
          <button type="button" className="playback-btn" onClick={() => setPaused(!paused)} disabled={finished}>
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button" className="playback-btn"
            onClick={() => setSpeed(LIVE_SPEEDS[(LIVE_SPEEDS.indexOf(speed) + 1) % LIVE_SPEEDS.length]!)}
          >
            {speed}×
          </button>
          <span className="playback-clock">{fmtTime(tSec)}</span>
          <button type="button" className="playback-btn" onClick={onAbort} title="Abandon the battle (no report)">✕</button>
        </div>

        <div className="playback">
          <BattleScene view={view} tSec={tSec} names={names} onArenaOrder={orderMove} />

          {/* Manual verb overrides (docs/08 §2). Chips toggle: active manual
              chip clicked again reverts that verb to auto. */}
          <div className="live-orders">
            <span className="live-orders-label">MOVE</span>
            <span className={`hud-chip btn${moveMode === 'waypoint' ? ' active' : ''}`} title="Click the arena to set a waypoint · right-click reverts to auto">
              waypoint
            </span>
            <button
              type="button" className={`hud-chip btn${moveMode === 'hold' ? ' active' : ''}`}
              onClick={() => setManual((m) => ({ ...m, move: m.move === 'hold' ? 'auto' : 'hold' }))}
              title="Stand fast in place"
            >
              hold
            </button>
            <span className="live-orders-label">THROTTLE</span>
            {THROTTLES.map((s) => (
              <button
                key={s} type="button"
                className={`hud-chip btn${manual.throttle === s ? ' active' : ''}`}
                onClick={() => setManual((m) => ({ ...m, throttle: m.throttle === s ? 'auto' : s }))}
              >
                {s}
              </button>
            ))}
            <span className="live-orders-spacer" />
            <button
              type="button"
              className={`hud-chip btn full-auto${manual === FULL_AUTO || (manual.move === 'auto' && manual.throttle === 'auto') ? ' active' : ''}`}
              onClick={() => setManual(FULL_AUTO)}
              title="Clear all manual orders; the autopilot resumes every verb"
            >
              FULL AUTO
            </button>
          </div>

          <BattleTicker view={view} tSec={tSec} names={names} />
          <BattleCaption view={view} />
        </div>

        {finished && <div className="live-endbanner">BATTLE DECIDED — preparing report…</div>}
      </div>
    </div>
  );
}
