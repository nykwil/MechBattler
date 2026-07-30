import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autopilotController, buildCapacitorMaxKj, withManualOrders, Battle,
  SPEED_SETTING_FRACTIONS,
  type Build, type BattleReport, type ManualOrders, type SpeedSetting, type Vec2,
} from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import { fmtTime } from '../lib/battleText.js';
import { useBattle } from '../state/useBattle.js';
import { BattleCaption, BattleScene, BattleTicker, frameAt, type BattleView, type WeaponOverride } from './BattleHud.js';
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

/**
 * All four of the sim's settings, labelled with the fraction of top speed each
 * actually commands. The percentages are SPEED_SETTING_FRACTIONS, not a UI guess:
 * cruise is 65%, not the round 70% it looks like it should be. 'stationary' is on
 * the segment now -- it is the 0% throttle, and leaving it off meant the control
 * could not express a stop.
 */
const THROTTLES: SpeedSetting[] = ['stationary', 'creep', 'cruise', 'flank'];
const throttlePct = (s: SpeedSetting) => `${Math.round(SPEED_SETTING_FRACTIONS[s] * 100)}%`;
/**
 * Face is what the sim models it as: MechFrame.faceMode is 'target' | 'bearing'
 * and nothing else. The cycle used to carry a fourth 'movement' state, which made
 * a two-way choice into a four-stop cycle nobody could predict from the label.
 * Auto is not a face mode -- it is the autopilot holding the verb (docs/08 §2).
 */
const FACE_MODES = ['auto', 'target', 'bearing'] as const;
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
      return {
        ...m,
        face: next,
        // Throttle and face leave auto together, because they are presented
        // together. Cycling face with the F key used to change face alone, which
        // left the throttle segment enabled with no setting shown while the
        // autopilot was still driving it -- controls that look manual and are not.
        throttle: next === 'auto' ? m.throttle : m.throttle === 'auto' ? (me?.speedSetting ?? 'cruise') : m.throttle,
        bearingRad: next === 'bearing' && me ? me.facingRad : m.bearingRad,
      };
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

  /**
   * What the mech is actually doing this tick, straight from the sim's frame. When
   * the autopilot holds throttle and face, the controls display these rather than a
   * stale manual value -- the readout chips that used to say it separately were the
   * redundancy, not the controls.
   */
  const live = frameAt(view, tSec)?.mechs[0];
  /** Auto owns throttle and face together, so one flag drives both controls. */
  const autoHolds = manual.throttle === 'auto' && manual.face === 'auto';

  return (
    /* Ported from docs/prototypes/mobile-battle.html: the console is the mech's
       instrument panel and the glass above it is the windshield. .battle-app scopes
       the prototype's stylesheet, which reuses class names the builder also owns. */
    <div className="battle-app battle-overlay" role="dialog" aria-modal="true">
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
            view={view} tSec={tSec} names={names} yourBuild={build}
            onArenaOrder={orderMove}
            weaponOverrides={manual.weapons}
            onWeaponClick={cycleWeapon}
            arenaOverlay={ripple && <circle key={ripple.key} className="live-ripple" cx={ripple.x} cy={ripple.y} />}
          />

          {/* Manual verb overrides (docs/08 §2). Chips toggle: active manual
              chip clicked again reverts that verb to auto. */}
          {/* Orders, ported to the prototype's .orders row: fixed-width .obtn
              toggles and a flexible .seg throttle, state carried by aria-pressed.
              The segment stays at the prototype's three throttles. A fourth AUTO
              segment squeezed them until 'cruise' truncated, and it was redundant:
              the Auto button already hands the throttle back to the autopilot. When
              it holds the throttle the segment carries .off to say so, but stays
              clickable, because clicking a throttle is how you take manual control. */}
          <div className="live-orders orders">
            <button
              type="button" className="obtn"
              aria-pressed={moveMode === 'hold'}
              onClick={() => setManual((m) => ({ ...m, move: m.move === 'hold' ? 'auto' : 'hold' }))}
              title="Stand fast in place"
            >
              Hold
            </button>

            {/* Under Auto the segment shows what the autopilot is doing and says
                so by being disabled, rather than going blank and leaving you to
                guess. Taking manual control is the Auto button's job now: a
                disabled control cannot also be the way out of the mode that
                disabled it. */}
            <span
              className={`seg${autoHolds ? ' off' : ''}`}
              role="group"
              aria-label={autoHolds ? 'Throttle (autopilot)' : 'Throttle'}
            >
              {THROTTLES.map((s) => (
                <button
                  key={s} type="button"
                  disabled={autoHolds}
                  aria-pressed={autoHolds ? live?.speedSetting === s : manual.throttle === s}
                  title={`${s} — ${throttlePct(s)} of top speed`}
                  onClick={() => setManual((m) => ({ ...m, throttle: s }))}
                >
                  {throttlePct(s)}
                </button>
              ))}
            </span>

            <button
              type="button" className="obtn"
              disabled={autoHolds}
              aria-pressed={autoHolds ? false : manual.face !== 'auto'}
              onClick={cycleFace}
              title={autoHolds
                ? `Autopilot is facing ${live?.faceMode === 'target' ? 'the target' : 'its heading'}`
                : 'Face the target, or hold a direction (aim it with an arena click)'}
            >
              {autoHolds
                ? (live?.faceMode === 'target' ? 'target' : 'direction')
                : manual.face === 'auto' ? 'Face'
                : manual.face === 'target' ? 'target' : 'direction'}
            </button>

            <button
              type="button" className="obtn"
              aria-pressed={isFullAuto(manual)}
              /* A toggle, not a one-way door. Throttle and face are disabled while
                 auto holds them, so if this only ever entered auto there would be
                 no way back out -- the same dead end the sheets had. Releasing
                 seeds the manual verbs with what the autopilot was already doing,
                 so taking control never jerks the mech. */
              onClick={() => setManual((m) => (isFullAuto(m)
                ? { ...m, throttle: live?.speedSetting ?? 'cruise', face: live?.faceMode ?? 'target' }
                : FULL_AUTO))}
              title={isFullAuto(manual)
                ? 'Take manual control of throttle and facing'
                : 'Clear all manual orders; the autopilot resumes every verb'}
            >
              Auto
            </button>
          </div>

          {moveMode === 'waypoint' && (
            <div className="live-orders orders">
              <span className="live-orders-label">Waypoint set — tap the glass to move it</span>
              <button
                type="button" className="obtn"
                aria-pressed={manual.autoOnArrival}
                onClick={() => setManual((m) => ({ ...m, autoOnArrival: !m.autoOnArrival }))}
                title="On arrival at the waypoint, clear every manual order and resume full auto"
              >
                On arrival
              </button>
            </div>
          )}

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
