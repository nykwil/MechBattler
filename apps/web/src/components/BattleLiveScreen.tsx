import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autopilotController, buildCapacitorMaxKj, withManualOrders, Battle,
  type Build, type BattleReport, type ManualOrders, type SpeedSetting, type Vec2,
} from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import { fmtTime } from '../lib/battleText.js';
import { useBattle } from '../state/useBattle.js';
import { BattleCaption, BattleScene, BattleTicker, type BattleView, type WeaponOverride } from './BattleHud.js';
import './BattleReportScreen.css';
import './BattlePlayback.css';
import './BattleLiveScreen.css';

/**
 * Command mode (docs/08): the battle steps live at 20 ticks/s with tactical
 * pause, rendered through the same scene as the replay. The player's standing
 * orders overlay the autopilot per verb — click the arena for a point order
 * (right-click reverts), click gun slots to cycle fire control, throttle and
 * face chips below. When the battle is decided the finished report opens in
 * the report screen.
 */

const LIVE_SPEEDS = [1, 2, 4] as const;
/** Hold the decided battle on screen briefly so the killing blow reads. */
const END_HOLD_S = 1.6;

const THROTTLES: SpeedSetting[] = ['creep', 'cruise', 'flank'];
/** Face-verb cycle (docs/08 §2): autopilot → force track → face travel → hold bearing. */
const FACE_MODES = ['auto', 'target', 'movement', 'bearing'] as const;
type FaceMode = (typeof FACE_MODES)[number];

interface ManualState {
  move: 'auto' | 'hold' | { dest: Vec2 };
  throttle: SpeedSetting | 'auto';
  weapons: Record<string, WeaponOverride>;
  face: FaceMode;
  /** Held bearing (rad); set from the last arena click while face = bearing. */
  bearingRad: number;
  /** The move order's trigger: on arrival, clear all manual state (docs/08 §2). */
  autoOnArrival: boolean;
}

const FULL_AUTO: ManualState = { move: 'auto', throttle: 'auto', weapons: {}, face: 'auto', bearingRad: 0, autoOnArrival: false };

function isFullAuto(m: ManualState): boolean {
  return m.move === 'auto' && m.throttle === 'auto' && m.face === 'auto' && Object.keys(m.weapons).length === 0;
}

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
    spawnDistanceM: opponent.spawnDistanceM,
    controllers: [
      withManualOrders(
        autopilotController,
        (): ManualOrders => {
          const m = manualRef.current;
          return {
            move: m.move === 'auto' ? undefined : m.move,
            throttle: m.throttle === 'auto' ? undefined : m.throttle,
            weapons: Object.keys(m.weapons).length > 0 ? m.weapons : undefined,
            face: m.face === 'auto' ? undefined
              : m.face === 'movement' ? 'movement'
              : m.face === 'target' ? { mode: 'target' }
              : { mode: 'bearing', bearingRad: m.bearingRad },
          };
        },
        () => {
          // Arrived at the manual waypoint: the standing trigger reverts to auto.
          if (manualRef.current.autoOnArrival) setManual(FULL_AUTO);
        },
      ),
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

  /** Order feedback: a ripple ring at the last waypoint click. */
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  useEffect(() => {
    if (!ripple) return;
    const id = window.setTimeout(() => setRipple(null), 650);
    return () => window.clearTimeout(id);
  }, [ripple]);

  const orderMove = (x: number, y: number, kind: 'move' | 'auto') => {
    if (finished) return;
    if (kind === 'auto') {
      setManual((m) => ({ ...m, move: 'auto', autoOnArrival: false }));
      return;
    }
    const hl = battle.arena.lengthM / 2;
    const hw = battle.arena.widthM / 2;
    const dest = { x: Math.max(-hl, Math.min(hl, x)), y: Math.max(-hw, Math.min(hw, y)) };
    setRipple({ x: dest.x, y: dest.y, key: Date.now() });
    setManual((m) => {
      const next: ManualState = { ...m, move: { dest } };
      // While holding a bearing, an arena click also aims it (docs/08 §2).
      const me = battle.latestFrame()?.mechs[0];
      if (m.face === 'bearing' && me) next.bearingRad = Math.atan2(dest.y - me.y, dest.x - me.x);
      return next;
    });
  };

  const cycleWeapon = (instanceId: string) => {
    setManual((m) => {
      const cur = m.weapons[instanceId];
      const weapons = { ...m.weapons };
      if (cur === undefined) weapons[instanceId] = 'hold';
      else if (cur === 'hold') weapons[instanceId] = 'force';
      else delete weapons[instanceId];
      return { ...m, weapons };
    });
  };

  const cycleFace = () => {
    setManual((m) => {
      const next = FACE_MODES[(FACE_MODES.indexOf(m.face) + 1) % FACE_MODES.length]!;
      // Entering bearing mode holds the current facing until a click re-aims it.
      const me = battle.latestFrame()?.mechs[0];
      return { ...m, face: next, bearingRad: next === 'bearing' && me ? me.facingRad : m.bearingRad };
    });
  };

  // Keybindings (docs/08 M4): space = pause, 1-9 = gun slots, A = full auto,
  // H = hold position, F = face cycle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!battle.finished) setPaused((p) => !p);
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1;
        const guns = battle.latestFrame()?.mechs[0].weapons ?? [];
        const gun = guns[idx];
        if (gun) cycleWeapon(gun.instanceId);
      } else if (e.key.toLowerCase() === 'a') {
        setManual(FULL_AUTO);
      } else if (e.key.toLowerCase() === 'h') {
        setManual((m) => ({ ...m, move: m.move === 'hold' ? 'auto' : 'hold' }));
      } else if (e.key.toLowerCase() === 'f') {
        cycleFace();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle]);

  const moveMode = manual.move === 'auto' ? 'auto' : manual.move === 'hold' ? 'hold' : 'waypoint';

  return (
    /* Ported from docs/prototypes/mobile-battle.html: the console is the mech's
       instrument panel and the glass above it is the windshield. .battle-app scopes
       the prototype's stylesheet, which reuses class names the builder also owns. */
    <div className="battle-app" role="dialog" aria-modal="true">
      <div className="app">
        <header className="topbar">
          <span className="live-dot" />
          <span className="live-title">Live · vs {opponent.name}</span>
          <span className="clock">{fmtTime(tSec)}</span>
          {/* Pause is a first-class control at full size, not a spacebar: orders
              cannot be issued as fast by thumb as by mouse, and the sim is
              tick-based so pausing costs nothing. */}
          <button
            type="button" className="tbtn" onClick={() => setPaused(!paused)} disabled={finished}
            aria-label={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button" className="tbtn"
            onClick={() => setSpeed(LIVE_SPEEDS[(LIVE_SPEEDS.indexOf(speed) + 1) % LIVE_SPEEDS.length]!)}
            aria-label="Playback speed"
          >
            {speed}×
          </button>
          <button type="button" className="tbtn" onClick={onAbort} aria-label="Abandon the battle">✕</button>
        </header>

        <div className="playback">
          <BattleScene
            view={view} tSec={tSec} names={names}
            onArenaOrder={orderMove}
            weaponOverrides={manual.weapons}
            onWeaponClick={cycleWeapon}
            arenaOverlay={ripple && <circle key={ripple.key} className="live-ripple" cx={ripple.x} cy={ripple.y} />}
          />

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
            {moveMode === 'waypoint' && (
              <button
                type="button" className={`hud-chip btn${manual.autoOnArrival ? ' active' : ''}`}
                onClick={() => setManual((m) => ({ ...m, autoOnArrival: !m.autoOnArrival }))}
                title="On arrival at the waypoint, clear every manual order and resume full auto"
              >
                auto on arrival
              </button>
            )}
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
            <span className="live-orders-label">FACE</span>
            <button
              type="button" className={`hud-chip btn${manual.face !== 'auto' ? ' active' : ''}`}
              onClick={cycleFace}
              title="Cycle: auto · track target · face travel direction · hold bearing (aim with an arena click)"
            >
              {manual.face}
            </button>
            <span className="live-orders-spacer" />
            <button
              type="button"
              className={`hud-chip btn full-auto${isFullAuto(manual) ? ' active' : ''}`}
              onClick={() => setManual(FULL_AUTO)}
              title="Clear all manual orders; the autopilot resumes every verb"
            >
              FULL AUTO
            </button>
          </div>

          <BattleTicker view={view} tSec={tSec} names={names} />
          <BattleCaption view={view} />
          <div className="playback-caption">
            keys: space pause · 1–9 cycle gun fire control · H hold position · F face mode · A full auto · right-click revert move
          </div>
        </div>

        {finished && <div className="live-endbanner">BATTLE DECIDED — preparing report…</div>}
      </div>
    </div>
  );
}
