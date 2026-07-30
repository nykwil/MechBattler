import { useMemo, useState, type ReactNode } from 'react';
import {
  getChassis, getPart, CELL_SIZE_M, CORE_HP, TICK_S,
  HEAT_AMBIENT_C, HEAT_DAMAGE_C, HEAT_FIRE_HOLD_C, HEAT_SHUTDOWN_C,
  type BattleEvent, type BattleFrame, type Build, type MechFrame, type WeaponFrame, type PartDef, type TerrainGrid,
} from '@mechbattler/sim';
import { eventText, fmtTime } from '../lib/battleText.js';
import { crossingSpeedMps } from '../lib/evade.js';
import { DamageGrid } from './DamageGrid.js';
import './BattlePlayback.css';

/**
 * The shared battle scene — enemy strip, arena, cockpit HUD, ticker — rendered
 * from playback frames at a given time. `BattlePlayback` (scrub a finished
 * report) and `BattleLiveScreen` (follow a running battle) are thin shells over
 * this; everything here reads recorded frames only (rule R6), so the two modes
 * cannot drift apart visually.
 */

/** The frame/event data the scene needs; a `BattleReport` satisfies it, and a
 * live view is assembled from a running `Battle`'s public fields. */
export interface BattleView {
  frames: BattleFrame[];
  events: BattleEvent[];
  arena: { lengthM: number; widthM: number };
  terrain: TerrainGrid;
  mechs: readonly [{ chassisId: string; capacitorMaxKj: number }, { chassisId: string; capacitorMaxKj: number }];
}

/** True footprints are ~3 m in a 240 m arena; magnify them to stay readable. */
const MECH_MAG = 5;
const TRACER_LINGER_S = 0.22;
const FLASH_LINGER_S = 0.4;
const MUZZLE_FLASH_S = 0.18;
export const MECH_COLORS = ['var(--signal-blue)', 'var(--signal-red)'] as const;
/**
 * Text variants. --signal-red is documented UI-only in docs/14 §4 — it measured
 * 4.38 rendered as the enemy's name, just under AA — so names use the token created
 * for exactly that, while marks and borders keep the fill colour.
 */
const MECH_TEXT_COLORS = ['var(--signal-blue)', 'var(--signal-red-text)'] as const;
/**
 * Heat gauge span: ambient to the damage threshold (docs/01 §4 ladder). Both ends
 * and both marks now come from the sim, which names them. They used to be typed
 * here -- a gauge marked 130 would have gone on saying 130 after the sim moved it.
 */
const HEAT_MIN_C = HEAT_AMBIENT_C;
const HEAT_MAX_C = HEAT_DAMAGE_C;

export function frameAt(view: BattleView, tSec: number): BattleFrame | undefined {
  const idx = Math.min(view.frames.length - 1, Math.max(0, Math.round(tSec / TICK_S) - 1));
  return view.frames[idx];
}

function shortName(partId: string): string {
  return getPart(partId).name.split(' (')[0]!;
}

/**
 * Ammo is not modelled: the sim does not consume it (packages/sim diversity.ts
 * calls U-AMMO a dead placeholder until Track C lands). The slot is shown because
 * it was asked for, but it reads as unavailable rather than as a count -- a number
 * here would be indistinguishable from a real one, and every figure on this screen
 * is supposed to come from the sim.
 */
const AMMO_PLACEHOLDER = 'ammo — (not modelled yet)';

function weaponBlurb(def: PartDef): string {
  const w = def.weapon!;
  const speed = w.projectileSpeed === 'hitscan' ? 'hitscan' : `${w.projectileSpeed} m/s`;
  return `${def.name} — ${w.damage}${w.salvoCount ? `×${w.salvoCount}` : ''} dmg every ${w.cycleS}s · ${speed}`
    + ` · band ${w.falloff.rangeStart}–${w.falloff.rangeEnd} m · arc ${w.mountArcDeg}° · ${AMMO_PLACEHOLDER}`;
}

/**
 * A weapon's mount arc, drawn as a sector out to the far edge of its falloff band.
 *
 * The arc is relative to the mech's facing, which is what makes the ARC gate
 * legible: the sim silences a gun when the target sits outside `mountArcDeg`, and
 * until now the only way to know that was to be told after the fact. Everything
 * here -- half-angle, both band edges -- is read from the catalog; nothing about
 * the geometry is decided in the UI.
 */
function WeaponCones({ frame, weapons, color }: {
  frame: MechFrame;
  weapons: WeaponFrame[];
  color: string;
}) {
  // One cone per distinct weapon type: two of the same gun share an arc exactly,
  // and stacking identical sectors just darkens the fill.
  const seen = new Set<string>();
  const cones = weapons.filter((wf) => {
    if (wf.status === 'destroyed' || seen.has(wf.partId)) return false;
    seen.add(wf.partId);
    return true;
  });

  const sector = (r: number, half: number) => {
    const a0 = frame.facingRad - half;
    const a1 = frame.facingRad + half;
    const x0 = frame.x + r * Math.cos(a0);
    const y0 = frame.y + r * Math.sin(a0);
    const x1 = frame.x + r * Math.cos(a1);
    const y1 = frame.y + r * Math.sin(a1);
    const largeArc = half * 2 > Math.PI ? 1 : 0;
    return `M ${frame.x} ${frame.y} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
  };

  return (
    <g className="playback-cones" aria-hidden="true">
      {cones.map((wf) => {
        const w = getPart(wf.partId).weapon!;
        const half = ((w.mountArcDeg / 2) * Math.PI) / 180;
        return (
          <g key={wf.instanceId} className={`playback-cone${wf.gate === null && wf.status === 'ok' ? ' bearing' : ''}`}>
            {/* Out to rangeEnd: past it the gun is out of its band entirely. */}
            <path d={sector(w.falloff.rangeEnd, half)} fill={color} className="cone-band" />
            {/* rangeStart is where damage begins to fall off, so the inner sector
                is the part of the cone that still hits for full damage. */}
            <path d={sector(w.falloff.rangeStart, half)} fill={color} className="cone-full" />
          </g>
        );
      })}
    </g>
  );
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

/** Command mode: a player's standing fire-control override on one gun. */
export type WeaponOverride = 'hold' | 'force';

function WeaponSlot({
  wf, fired, compact, onHover, override, onClick,
}: {
  wf: WeaponFrame;
  fired: boolean;
  compact?: boolean;
  onHover?: (partId: string | null) => void;
  override?: WeaponOverride;
  onClick?: () => void;
}) {
  const def = getPart(wf.partId);
  const cls = [
    'hud-slot',
    wf.status,
    !wf.enabled && wf.status === 'ok' ? 'holdfire' : '',
    fired ? 'fired' : '',
    compact ? 'compact' : '',
    override ? `ovr-${override}` : '',
    onClick ? 'clickable' : '',
  ].filter(Boolean).join(' ');
  const ovrText = override === 'hold' ? ' — manual: HOLD FIRE' : override === 'force' ? ' — manual: FORCE FIRE' : '';
  // Not-firing legibility (docs/09 M2): name the specific fire-control gate
  // instead of one ambiguous HOLD. A player hold is an order, not a diagnosis
  // — it wins the label so "I said stop" never reads as a malfunction.
  // The player-hold label keys off the override, not the sim's enabled flag —
  // the order must read back instantly even while paused, before the next
  // controller tick applies it.
  const silence =
    wf.status !== 'ok'
      ? null
      : override === 'hold'
        ? { label: 'HOLD', blurb: 'holding fire on your order' }
        : wf.enabled
          ? null
          : wf.gate === 'range'
          ? { label: 'RANGE', blurb: 'target beyond this gun\'s reach' }
          : wf.gate === 'arc'
            ? { label: 'ARC', blurb: 'target outside the mount arc — turn to bear' }
            : wf.gate === 'heat'
              ? { label: 'HOT', blurb: `fire control holding at ≥${HEAT_FIRE_HOLD_C}°C (shutdown at ${HEAT_SHUTDOWN_C}°C)` }
              : { label: 'HOLD', blurb: 'fire control holding' };
  const className = `gun${compact ? ' compact' : ''}${cls.includes('destroyed') ? ' dead' : ''}`;
  const body = (
    <>
      {/* Fill is time to next shot. The prototype learned to build these once and
          update in place: rebuilding every frame ate taps between pointerdown and
          pointerup and restarted the fill transition before it could finish. */}
      <span className="gun-fill" style={{ width: `${wf.readyFrac * 100}%` }} />
      <span className="gun-top">
        <span className="gun-nm">{shortName(wf.partId)}</span>
        <span className="gun-why">
          {wf.status === 'destroyed' ? 'Dead'
            : wf.status === 'shutdown' ? 'Hot'
              : wf.status === 'shed' ? 'Power'
                : silence ? silence.label
                  : wf.readyFrac >= 1 ? 'Ready' : ''}
        </span>
      </span>
      {/* The prototype's .gun-rng is a two-column grid -- range info, then hint --
          and the port only ever filled the hint, leaving the designed slot blank.
          Band and arc are what decide whether a gun can speak, and the RANGE/ARC
          gates already name them as reasons; showing the numbers means you can see
          the gate coming instead of only being told after it fires. */}
      <span className={`gun-rng${wf.gate === null && wf.status === 'ok' ? ' in' : ''}`}>
        <span>
          {def.weapon!.falloff.rangeStart}–{def.weapon!.falloff.rangeEnd}m · {def.weapon!.mountArcDeg}°
        </span>
        <span className="gun-hint">{override ? (override === 'hold' ? 'held' : 'forced') : ''}</span>
      </span>
    </>
  );

  // Read-only where there is nothing to click -- the enemy strip mirrors their guns
  // but cannot order them, so a button there is a focus stop that does nothing.
  if (!onClick) {
    return <span className={className} title={weaponBlurb(def)}>{body}</span>;
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={override === 'force'}
      title={weaponBlurb(def) + ovrText + (silence ? ` — ${silence.blurb}` : '')}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(wf.partId) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      {body}
    </button>
  );
}

/**
 * Heat as a column, which is the prototype's design and was never ported -- its
 * CSS has been sitting in battle.css unused while the console showed a horizontal
 * bar. What you need from heat is headroom before cutout, and a column shows
 * headroom at a glance in a way a horizontal bar does not.
 *
 * The risk line predicts time to shutdown from the slope of the last second of
 * frames. That is measured from the recorded temperatures, not modelled here: the
 * HUD may not re-derive the sim's thermal maths (docs/02 §6).
 */
function HeatColumn({ view, tSec, tempC }: { view: BattleView; tSec: number; tempC: number }) {
  const frac = (tempC - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C);
  const mark = (c: number) => `${((c - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C)) * 100}%`;

  const risk = useMemo(() => {
    if (tempC >= HEAT_SHUTDOWN_C) return { text: 'Cut out', cls: 'bad' };
    const back = frameAt(view, Math.max(0, tSec - 1));
    const now = frameAt(view, tSec);
    if (!back || !now) return { text: 'Nominal', cls: '' };
    const ratePerS = now.mechs[0].hottestCellC - back.mechs[0].hottestCellC;
    if (ratePerS <= 0.05) return tempC >= HEAT_FIRE_HOLD_C
      ? { text: 'Holding fire', cls: 'warn' }
      : { text: 'Nominal', cls: '' };
    const secs = (HEAT_SHUTDOWN_C - tempC) / ratePerS;
    if (secs > 60) return { text: 'Nominal', cls: '' };
    return { text: `${Math.ceil(secs)}s to cut`, cls: secs <= 10 ? 'bad' : 'warn' };
  }, [view, tSec, tempC]);

  return (
    <div className="heatcol">
      <span className="heat-k">Heat</span>
      <span
        className="heat-track"
        role="meter"
        aria-valuenow={Math.round(tempC)}
        aria-valuemin={HEAT_MIN_C}
        aria-valuemax={HEAT_MAX_C}
        aria-label={`Heat ${Math.round(tempC)} degrees, shutdown at ${HEAT_SHUTDOWN_C}`}
      >
        <i
          className={`heat-fill${tempC >= HEAT_SHUTDOWN_C ? ' hot' : ''}`}
          style={{ height: `${Math.min(100, Math.max(0, frac * 100))}%` }}
        />
        <span className="heat-mark warn" style={{ bottom: mark(HEAT_FIRE_HOLD_C) }} />
        <span className="heat-mark stop" style={{ bottom: mark(HEAT_SHUTDOWN_C) }} />
      </span>
      <span className="heat-v">{Math.round(tempC)}°</span>
      <span className={`heat-risk ${risk.cls}`}>{risk.text}</span>
    </div>
  );
}

function Gauge({
  label, frac, marks, cls, text,
}: {
  label: string;
  frac: number;
  marks?: number[];
  cls: string;
  text: string;
}) {
  return (
    <div className="hud-gauge">
      <span className="hud-gauge-label">{label}</span>
      <span className="hud-gauge-track">
        <span className={`hud-gauge-fill ${cls}`} style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }} />
        {marks?.map((m) => <span key={m} className="hud-gauge-mark" style={{ left: `${m * 100}%` }} />)}
      </span>
      <span className="hud-gauge-text">{text}</span>
    </div>
  );
}

export function BattleScene({
  view, tSec, names, onArenaOrder, weaponOverrides, onWeaponClick, arenaOverlay, yourBuild,
}: {
  view: BattleView;
  tSec: number;
  names: [string, string];
  /** Command mode: left-click = point order at arena coords, right-click = revert to auto. */
  onArenaOrder?: (x: number, y: number, kind: 'move' | 'auto') => void;
  /** Command mode: the player's standing per-gun overrides, shown on the slots. */
  weaponOverrides?: Record<string, WeaponOverride>;
  /** Command mode: click a gun slot to cycle auto → hold-fire → force-fire. */
  onWeaponClick?: (instanceId: string) => void;
  /** Extra SVG rendered over the arena (order feedback like click ripples). */
  arenaOverlay?: ReactNode;
  /** Your build, for the console's damage widget. Omitted where it is unknown. */
  yourBuild?: Build;
}) {
  const [hoveredWeapon, setHoveredWeapon] = useState<string | null>(null);
  const frame = frameAt(view, tSec);

  // Shots fired just before `tSec` become tracers; hits also flash the target.
  const tracers = useMemo(
    () => view.events.filter(
      (e): e is Extract<BattleEvent, { type: 'shot' }> =>
        e.type === 'shot' && e.tSec <= tSec && e.tSec > tSec - TRACER_LINGER_S,
    ),
    [view.events, tSec],
  );
  /**
   * Rounds still in the air. A shot event records when a gun fired, not where its
   * round is, so position is the shooter-to-target line walked at the weapon's own
   * projectileSpeed -- 250 m/s from a rocket pod and 2000 m/s from a rail gun cross
   * the same arena at visibly different rates, which is the whole point of showing
   * them. Hitscan weapons have no travel time and stay instantaneous tracers.
   *
   * The window is the round's own flight time rather than a fixed linger, because a
   * slow projectile at long range is airborne far longer than any constant would
   * allow for.
   */
  const projectiles = useMemo(() => {
    const live: { key: string; x: number; y: number; mech: 0 | 1 }[] = [];
    for (const e of view.events) {
      if (e.type !== 'shot' || e.tSec > tSec) continue;
      const speed = getPart(e.partId).weapon?.projectileSpeed;
      if (speed === undefined || speed === 'hitscan') continue;
      const f = frameAt(view, e.tSec);
      if (!f) continue;
      const from = f.mechs[e.mech];
      const to = f.mechs[(1 - e.mech) as 0 | 1];
      const distM = Math.hypot(to.x - from.x, to.y - from.y);
      const flightS = distM / speed;
      if (flightS <= 0) continue;
      const progress = (tSec - e.tSec) / flightS;
      if (progress < 0 || progress > 1) continue;
      live.push({
        key: `${e.tSec}:${e.instanceId}`,
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        mech: e.mech,
      });
    }
    return live;
  }, [view, tSec]);

  const flashes = useMemo(
    () => view.events.filter(
      (e) => (e.type === 'part-destroyed' || e.type === 'cookoff') && e.tSec <= tSec && e.tSec > tSec - FLASH_LINGER_S,
    ),
    [view.events, tSec],
  );
  /** Weapon instances that fired within the muzzle-flash window (slot flash). */
  const firedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of view.events) {
      if (e.type === 'shot' && e.tSec <= tSec && e.tSec > tSec - MUZZLE_FLASH_S) ids.add(`${e.mech}:${e.instanceId}`);
    }
    return ids;
  }, [view.events, tSec]);

  const halfL = view.arena.lengthM / 2;
  const halfW = view.arena.widthM / 2;
  const margin = 8;

  if (!frame) return null;
  const you = frame.mechs[0];
  const foe = frame.mechs[1];

  /*
   * Evade: your crossing speed across THEIR line of sight, which is how hard you
   * are to hit. The prototype added this instrument with the note that it "is the
   * single biggest term in whether you get hit, and it was nowhere on the HUD",
   * and that was true of ours too.
   *
   * MechFrame carries position but no velocity, so it is differenced from the
   * previous tick over the sim's own TICK_S. Derived from sim output only -- no
   * combat constant is restated here.
   */
  const evadeMps = (() => {
    const idx = Math.min(view.frames.length - 1, Math.max(0, Math.round(tSec / TICK_S) - 1));
    const prev = view.frames[idx - 1];
    return prev ? crossingSpeedMps(prev.mechs[0], you, foe, TICK_S) : 0;
  })();
  /** Full scale for the Evade bar; the prototype's reference for a fast crossing. */
  const EVADE_FULL_MPS = 6;
  const heatFrac = (m: MechFrame) => (m.hottestCellC - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C);

  return (
    <>
      {/* Enemy strip (compact mirror of the cockpit). */}
      <div className="hud-enemy" style={{ borderColor: MECH_COLORS[1] }}>
        <span className="hud-name" style={{ color: MECH_TEXT_COLORS[1] }}>{names[1]}</span>
        <span className="hud-meter" title="Core HP">
          <span className="hud-meter-fill core" style={{ width: `${(100 * Math.max(0, foe.coreHp)) / CORE_HP}%` }} />
        </span>
        <span className="hud-meter" title="Functional mass">
          <span className="hud-meter-fill mass" style={{ width: `${100 * foe.functionalMassFrac}%` }} />
        </span>
        <span className="hud-meter" title={`Heat: ${foe.hottestCellC.toFixed(0)}°C`}>
          <span className="hud-meter-fill heat" style={{ width: `${Math.min(100, Math.max(0, heatFrac(foe) * 100))}%` }} />
        </span>
        <span className="hud-enemy-slots">
          {foe.weapons.map((wf) => (
            <WeaponSlot key={wf.instanceId} wf={wf} fired={firedIds.has(`1:${wf.instanceId}`)} compact />
          ))}
        </span>
        <span className="hud-chip">{foe.speedSetting}</span>
        <span className="hud-chip">{foe.moveIntent}</span>
        {foe.tile !== 'open' && <span className={`hud-chip tile-${foe.tile}`}>{foe.tile}</span>}
      </div>

      {/* The canopy: chamfered bezel and corner brackets frame the glass, and
          what the glass shows is an overhead map -- that split is what decides
          where everything goes (docs/prototypes/mobile-battle.html). */}
      <div className="arena-wrap">
      <div className="canopy-frame">
      <div className="canopy">
      <svg
        className={`arena playback-arena${onArenaOrder ? ' commandable' : ''}`}
        viewBox={`${-halfL - margin} ${-halfW - margin} ${2 * (halfL + margin)} ${2 * (halfW + margin)}`}
        onPointerDown={onArenaOrder ? (e) => {
          const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse());
          onArenaOrder(pt.x, pt.y, e.button === 2 ? 'auto' : 'move');
        } : undefined}
        onContextMenu={onArenaOrder ? (e) => e.preventDefault() : undefined}
      >
        {/* Terrain tiles (docs/03 §2): forest = cover, hill = range, water = cooling. */}
        {view.terrain.cells.flatMap((row, ry) =>
          row.map((tile, cx) =>
            tile === 'open' ? null : (
              <rect
                key={`t${cx}-${ry}`}
                className={`playback-tile ${tile}`}
                x={-halfL + cx * view.terrain.cellSizeM}
                y={-halfW + ry * view.terrain.cellSizeM}
                width={view.terrain.cellSizeM}
                height={view.terrain.cellSizeM}
              />
            ),
          ),
        )}
        <rect x={-halfL} y={-halfW} width={2 * halfL} height={2 * halfW} className="playback-walls" />
        {/* The grid is the terrain grid. It used to be drawn every 25 m from the
            arena centre while the tiles are laid from the corner at the sim's
            cellSizeM, so the lines crossed the tiles they were meant to bound --
            and only verticals were drawn, so it was not a grid at all. Both axes
            now step the same cell size the terrain does; 25 was a UI-invented
            constant of exactly the kind CLAUDE.md forbids. */}
        {Array.from({ length: view.terrain.cols + 1 }, (_, i) => -halfL + i * view.terrain.cellSizeM).map((x) => (
          <line key={`gv${x}`} x1={x} y1={-halfW} x2={x} y2={halfW} className="playback-gridline" />
        ))}
        {Array.from({ length: view.terrain.rows + 1 }, (_, i) => -halfW + i * view.terrain.cellSizeM).map((y) => (
          <line key={`gh${y}`} x1={-halfL} y1={y} x2={halfL} y2={y} className="playback-gridline" />
        ))}

        {/* Destination markers: the standing move order, drawn like an RTS waypoint. */}
        {([0, 1] as const).map((i) => {
          const m = frame.mechs[i];
          if (!m.dest) return null;
          return (
            <g key={`dest${i}`} className="playback-dest" stroke={MECH_COLORS[i]}>
              <line x1={m.x} y1={m.y} x2={m.dest.x} y2={m.dest.y} />
              <path
                d={`M ${m.dest.x} ${m.dest.y - 2.6} L ${m.dest.x + 2.6} ${m.dest.y} L ${m.dest.x} ${m.dest.y + 2.6} L ${m.dest.x - 2.6} ${m.dest.y} Z`}
                fill="none"
              />
            </g>
          );
        })}

        {projectiles.map((p) => (
          <circle
            key={p.key}
            cx={p.x} cy={p.y} r={1.1}
            className="playback-round"
            fill={MECH_COLORS[p.mech]}
          />
        ))}

        {tracers.map((e, idx) => {
          // A travelling round is drawn as the round; only hitscan is a line.
          if (getPart(e.partId).weapon?.projectileSpeed !== 'hitscan') return null;
          const f = frameAt(view, e.tSec);
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
          const f = frameAt(view, e.tSec);
          if (!f) return null;
          const m = f.mechs[e.mech];
          const age = (tSec - e.tSec) / FLASH_LINGER_S;
          return <circle key={`fl${idx}`} cx={m.x} cy={m.y} r={3 + age * 8} className="playback-boom" opacity={1 - age} />;
        })}

        {/* Cones under the glyphs: they are context for where a gun can reach,
            not something to read the mech's position through. Both mechs get
            them -- knowing which of the enemy's guns can bear on you is the same
            question from the other side, and it is what deciding to close or
            orbit actually turns on. */}
        {([0, 1] as const).map((i) => (
          <WeaponCones
            key={`c${i}`}
            frame={frame.mechs[i]}
            weapons={frame.mechs[i].weapons}
            color={MECH_COLORS[i]}
          />
        ))}
        {([0, 1] as const).map((i) => (
          <MechGlyph key={i} frame={frame.mechs[i]} chassisId={view.mechs[i].chassisId} color={MECH_COLORS[i]} />
        ))}
        {arenaOverlay}
      </svg>
      <span className="corner tl" /><span className="corner tr" />
      <span className="corner bl" /><span className="corner br" />
      </div>
      </div>
      </div>


      {/* The console IS the mech's instrument panel: every instrument lives here,
          and only map marks go on the glass above (docs/14 §12). */}
      <div className="console">
       <div className="con-main">
        <div className="con-instruments">
          {/* The prototype's damage widget: your mech as a shape, so a loss reads
              as where rather than how much. Opens the log, as it does there. */}
          {yourBuild && (
            <DamageGrid
              build={yourBuild}
              events={view.events}
              tSec={tSec}
              coreFrac={Math.max(0, you.coreHp) / CORE_HP}
            />
          )}
          <div className="con-bars">
            <div className="cbar">
              <span className="cbar-k">Core</span>
              <span className="cbar-t">
                <i className="cbar-f core" style={{ width: `${(100 * Math.max(0, you.coreHp)) / CORE_HP}%` }} />
              </span>
              <span className="cbar-v">{Math.max(0, Math.round(you.coreHp))}</span>
            </div>
            <div className="cbar">
              <span className="cbar-k">Evade</span>
              <span className="cbar-t">
                <i
                  className="cbar-f evade"
                  style={{ width: `${Math.min(100, (evadeMps / EVADE_FULL_MPS) * 100)}%` }}
                />
              </span>
              <span className="cbar-v">{evadeMps.toFixed(1)}</span>
            </div>
            {/* Functional mass only decides a timeout, so it gets a hairline
                rather than a headline. */}
            <div className="cbar tiny">
              <span className="cbar-k">Mass</span>
              <span className="cbar-t">
                <i className="cbar-f mass" style={{ width: `${100 * you.functionalMassFrac}%` }} />
              </span>
              <span className="cbar-v">{Math.round(you.functionalMassFrac * 100)}%</span>
            </div>
          </div>
          {/* Full console height, as the prototype has it: the taller the column,
              the more precisely headroom to cutout can be read. */}
          <HeatColumn view={view} tSec={tSec} tempC={you.hottestCellC} />
        </div>

        <div className="gunrow" role="group" aria-label="Weapons">
            {you.weapons.length === 0 && <span className="hud-empty">no weapons</span>}
            {you.weapons.map((wf) => (
              <WeaponSlot
                key={wf.instanceId} wf={wf}
                fired={firedIds.has(`0:${wf.instanceId}`)}
                onHover={setHoveredWeapon}
                override={weaponOverrides?.[wf.instanceId]}
                onClick={onWeaponClick ? () => onWeaponClick(wf.instanceId) : undefined}
              />
            ))}
        </div>
        {/* Hover detail is a pointer affordance, so it exists only where a pointer
            does. On a phone it could never be filled, yet it held two permanent
            lines of console -- the scarcest space on the screen -- to say so. The
            band and arc it used to reveal are on the gun chips now, which is where
            a thumb can read them. */}
        <p className="con-foot hover-only">
          {hoveredWeapon ? weaponBlurb(getPart(hoveredWeapon)) : 'fill = time to next shot · Range/Arc/Hot = why fire control holds'}
        </p>

        <div className="hud-gauges">
          {view.mechs[0].capacitorMaxKj > 0 && (
            <Gauge
              label="CAP" frac={you.capacitorKj / view.mechs[0].capacitorMaxKj} cls="cap"
              text={`${you.capacitorKj.toFixed(0)}/${view.mechs[0].capacitorMaxKj} kJ`}
            />
          )}
          <Gauge
            label="PWR" frac={you.supplyKw > 0 ? you.demandKw / you.supplyKw : 0}
            cls={you.demandKw > you.supplyKw ? 'pwr-over' : 'pwr'}
            text={`${you.demandKw.toFixed(0)}/${you.supplyKw.toFixed(0)} kW`}
          />
          {/* Throttle and facing used to be restated here as chips, beside the
              controls that set them and show them. Only the terrain tile is left:
              nothing else in the console says what you are standing in, and it
              changes cover, range and cooling. */}
          <div className="hud-verbs">
            {you.tile !== 'open' && (
              <span
                className={`hud-chip tile-${you.tile}`}
                title={you.tile === 'forest' ? 'Forest: cover from incoming fire, slower' : you.tile === 'hill' ? 'Hill: extended weapon range' : 'Water: radiators boosted, much slower'}
              >
                {you.tile}
              </span>
            )}
          </div>
        </div>
       </div>
      </div>
    </>
  );
}

/** Decisions and consequences up to now (routine shots stay out). */
export function BattleTicker({ view, tSec, names }: { view: BattleView; tSec: number; names: [string, string] }) {
  const rows = useMemo(() => {
    const kept = view.events.filter((e) => {
      if (e.tSec > tSec) return false;
      if (e.type === 'shot') return e.hit && e.totalDamageDealt >= 15;
      return true;
    });
    return kept.slice(-6);
  }, [view.events, tSec]);
  return (
    <div className="playback-ticker">
      {rows.map((e, idx) => {
        const { text, cls } = eventText(e, names);
        return (
          <div key={`${e.tSec}-${idx}`} className={`playback-ticker-row ${cls}`}>
            <span className="playback-ticker-time">{fmtTime(e.tSec)}</span>
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BattleCaption({ view }: { view: BattleView }) {
  return (
    <div className="playback-caption">
      mech footprints magnified {MECH_MAG}× · arena {view.arena.lengthM} × {view.arena.widthM} m ·
      <span className="tile-key forest"> ■</span> forest (cover)
      <span className="tile-key hill"> ■</span> hill (range)
      <span className="tile-key water"> ■</span> water (cooling)
    </div>
  );
}
