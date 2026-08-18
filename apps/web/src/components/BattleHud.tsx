import { useMemo, type ReactNode } from 'react';
import {
  getChassis, getPart, CELL_SIZE_M, TICK_S,
  HEAT_AMBIENT_C, HEAT_DAMAGE_C, HEAT_FIRE_HOLD_C, HEAT_SHUTDOWN_C,
  computeHitModel, effectiveMults, falloffAt, meanSilhouetteHalfWidthM,
  FOREST_COVER_MULT,
  weaponSigmaRad, TRACKING_LAG_S, resolveFireControlLateralMult,
  type BattleEvent, type BattleFrame, type Build, type MechFrame, type WeaponFrame, type PartDef, type TerrainGrid, type TerrainType,
} from '@mechbattler/sim';
import { eventText, fmtTime } from '../lib/battleText.js';
import { crossingSpeedMps } from '../lib/evade.js';
import { DamageGrid } from './DamageGrid.js';
import { BattleDiagnostics } from './BattleDiagnostics.js';
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
  mechs: readonly [BattleViewMech, BattleViewMech];
}

export interface BattleViewMech {
  chassisId: string;
  capacitorMaxKj: number;
  /**
   * Each part's footprint centre in grid cells, so a round can leave the gun that
   * fired it. Optional because a view can be assembled without a build (the
   * fire-control tests do), in which case shots fall back to the mech's centre.
   */
  mounts?: Record<string, { x: number; y: number }>;
}

/** True footprints are ~3 m in a 240 m arena; magnify them to stay readable. */
const MECH_MAG = 5;
const TRACER_LINGER_S = 0.22;
/** Length of a round's visible streak, metres of arena. */
const ROUND_LEN_M = 3;
const FLASH_LINGER_S = 0.4;
const MUZZLE_FLASH_S = 0.18;
/** How long a hitscan beam stays on the glass. */
const BEAM_LINGER_S = 0.16;
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

/**
 * Which frame a time lands on. Derived from the tick rate rather than searched for:
 * callers that need the *previous* frame were using frames.indexOf(frame), which is
 * a linear scan of the whole battle on every render -- and worse, it depends on
 * object identity, so a rebuilt frame array would silently return -1 and report a
 * standing mech as moving at zero.
 */
/**
 * The mech's fire-control share of the lateral-target penalty at this moment --
 * `Combatant.fireControlLateralMult` replayed from the event stream.
 *
 * The product itself comes from the sim's `resolveFireControlLateralMult` --
 * the same call `Combatant.fireControlLateralMult` makes -- so the HUD cannot
 * disagree with the model it reports on. Only the gating is the HUD's, because
 * only the HUD has to replay it.
 *
 * The sim requires the part to be fitted, functional, and neither shed nor shut
 * down. Only the first is visible from a build, so the rest is replayed up to
 * tSec, the way DamageGrid derives destroyed parts. Assuming the ungated penalty
 * instead would make the spread and the diagnostics disagree with the model they
 * report on, precisely on the builds fitted to change it.
 */
/**
 * The instances that are not contributing at `tSec`: destroyed, shed or shut
 * down. Every mech-wide term the sim gates on `isPartFunctional` plus the
 * runtime's shed/shutdown flags needs exactly this set, and none of it is on a
 * frame -- it has to be replayed from the event stream.
 *
 * `DamageGrid` deliberately does NOT use this: it tracks `part-destroyed` only,
 * because it draws permanent damage, and a shed or shut-down part is neither
 * damaged nor gone.
 */
function downedAt(view: BattleView, tSec: number, mech: 0 | 1): Set<string> {
  const down = new Set<string>();
  for (const e of view.events) {
    if (e.tSec > tSec) break;
    // Narrow by type before reading `mech`: not every event has one (`victory`).
    if (e.type !== 'part-destroyed' && e.type !== 'shed' && e.type !== 'shutdown') continue;
    if (e.mech === mech) down.add(e.instanceId);
  }
  return down;
}

export function fireControlLateralMultAt(
  view: BattleView, build: Build | undefined, tSec: number, mech: 0 | 1,
): number {
  if (!build) return 1;
  const down = downedAt(view, tSec, mech);
  return resolveFireControlLateralMult(build.parts, (id) => !down.has(id));
}

/**
 * The target's profile multiplier: the product of its own modifiers' targetProfile
 * terms, which is how a mech makes itself harder to hit. Mirrors Combatant's
 * profileMult, including its condition that a part is skipped once destroyed, shed
 * or shut down -- replayed from events, since none of that is on a frame.
 */
function partMultProductAt(
  view: BattleView, build: Build | undefined, tSec: number, mech: 0 | 1,
  ctx: { speedMps: number; tile: TerrainType },
  field: 'targetProfile' | 'mechMoveJitter' | 'turnJitter',
): number {
  const parts = build?.parts.filter((p) => p.modifiers?.length) ?? [];
  if (parts.length === 0) return 1;
  const down = downedAt(view, tSec, mech);
  let mult = 1;
  for (const p of parts) {
    if (down.has(p.instanceId)) continue;
    // tempC is the one term that cannot be recovered: the sim reads each part's own
    // mean cell temperature, and a frame carries temperature for weapons only.
    // Ambient is the closest honest stand-in, and it is exact for every modifier
    // whose profile term does not vary with heat -- which is all of them today.
    mult *= effectiveMults(p, { tempC: HEAT_AMBIENT_C, speedMps: ctx.speedMps, tile: ctx.tile })[field];
  }
  return mult;
}

export function targetProfileMultAt(
  view: BattleView, build: Build | undefined, tSec: number, mech: 0 | 1,
  ctx: { speedMps: number; tile: TerrainType },
): number {
  return partMultProductAt(view, build, tSec, mech, ctx, 'targetProfile');
}

/**
 * The frame's total steadiness against its own motion: the chassis's authored
 * `moveJitterMult` times the mech-wide product its parts contribute. This is
 * `(self.chassis.moveJitterMult ?? 1) * self.mechMoveJitterMult(tile)` from
 * `Battle.effectiveDispersionRad`, and it exists as one exported function
 * because passing only the chassis half is a mistake this file has now made
 * three times -- once for chassis steadiness, once for forest cover, and once
 * here when `mechMoveJitter` was added to the sim and the instruments were not
 * widened with it. Coil-sprung actuators (x0.6) drew the spread ~1.67x too
 * wide; Weaving gait (x1.3) drew it too narrow.
 *
 * Every caller of `weaponSigmaRad` in the app must source
 * `chassisMoveJitterMult` from here rather than from `getChassis`.
 */
export function chassisMoveJitterMultAt(
  view: BattleView, build: Build | undefined, tSec: number, mech: 0 | 1,
  ctx: { speedMps: number; tile: TerrainType },
): number {
  return (getChassis(view.mechs[mech].chassisId).moveJitterMult ?? 1)
    * partMultProductAt(view, build, tSec, mech, ctx, 'mechMoveJitter');
}

export function frameIndexAt(view: BattleView, tSec: number): number {
  return Math.min(view.frames.length - 1, Math.max(0, Math.round(tSec / TICK_S) - 1));
}

export function frameAt(view: BattleView, tSec: number): BattleFrame | undefined {
  return view.frames[frameIndexAt(view, tSec)];
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

/**
 * Compact range legend: min · idealMin–idealMax · max (e.g. `10 · 10–40 · 90m`).
 * The middle span is the sweet spot; outside it the cone/damage fades to empty.
 */
function formatWeaponRange(falloff: {
  min?: number;
  idealMin: number;
  idealMax: number;
  max: number;
}): string {
  const min = falloff.min ?? 0;
  return `${min} · ${falloff.idealMin}–${falloff.idealMax} · ${falloff.max}m`;
}

/**
 * Delivered only through the `title` attribute — a native tooltip, which is a real
 * popup: it floats, costs no layout, and is plainly not part of the cockpit. There
 * used to be a styled line rendered alongside it, which was the same text twice and
 * looked like interface. This detail is a development aid, not a surface the final
 * interface owns, so it should never occupy the cockpit's space.
 */
function weaponBlurb(def: PartDef): string {
  const w = def.weapon!;
  const speed = w.projectileSpeed === 'hitscan' ? 'hitscan' : `${w.projectileSpeed} m/s`;
  const f = w.falloff;
  const min = f.min ?? 0;
  const bandNote = min > 0 || f.idealMin > 0
    ? ` · empty under ${min} m, sweet ${f.idealMin}–${f.idealMax} m, dead past ${f.max} m`
    : ` · full to ${f.idealMax} m, dead past ${f.max} m`;
  return `${def.name} — ${w.damage}${w.salvoCount ? `×${w.salvoCount}` : ''} dmg every ${w.cycleS}s · ${speed}`
    + ` · ${formatWeaponRange(w.falloff)}${bandNote} · arc ${w.mountArcDeg}° · ${AMMO_PLACEHOLDER}`;
}

/**
 * Engagement cone sampled from the same falloff curve as damage:
 * empty under min → fade up to idealMin → solid idealMin–idealMax → fade to 0 at max.
 * Peak fill opacity is modest (~0.4) so the sweet spot reads only a bit stronger
 * than the fades.
 */
function WeaponCones({ frame, weapons, color, mech }: {
  frame: MechFrame;
  weapons: WeaponFrame[];
  color: string;
  /** Which mech, so two mechs' gradient ids can never collide. */
  mech: number;
}) {
  // One cone per distinct weapon type: two of the same gun share an arc exactly,
  // and stacking identical sectors just darkens the fill.
  const seen = new Set<string>();
  const cones = weapons.filter((wf) => {
    if (wf.status === 'destroyed' || seen.has(wf.partId)) return false;
    seen.add(wf.partId);
    return true;
  });

  /** Ring sector from inner radius `r0` to outer `r1`. */
  const annular = (r0: number, r1: number, half: number) => {
    if (r1 <= r0) return '';
    const a0 = frame.facingRad - half;
    const a1 = frame.facingRad + half;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const largeArc = half * 2 > Math.PI ? 1 : 0;
    if (r0 <= 0) {
      const x0 = frame.x + r1 * c0;
      const y0 = frame.y + r1 * s0;
      const x1 = frame.x + r1 * c1;
      const y1 = frame.y + r1 * s1;
      return `M ${frame.x} ${frame.y} L ${x0} ${y0} A ${r1} ${r1} 0 ${largeArc} 1 ${x1} ${y1} Z`;
    }
    return (
      `M ${frame.x + r1 * c0} ${frame.y + r1 * s0}`
      + ` A ${r1} ${r1} 0 ${largeArc} 1 ${frame.x + r1 * c1} ${frame.y + r1 * s1}`
      + ` L ${frame.x + r0 * c1} ${frame.y + r0 * s1}`
      + ` A ${r0} ${r0} 0 ${largeArc} 0 ${frame.x + r0 * c0} ${frame.y + r0 * s0} Z`
    );
  };

  return (
    <g className="playback-cones" aria-hidden="true">
      {cones.map((wf) => {
        const def = getPart(wf.partId);
        const w = def.weapon!;
        const half = ((w.mountArcDeg / 2) * Math.PI) / 180;
        const rMin = w.falloff.min ?? 0;
        const rIdealMin = w.falloff.idealMin;
        const rIdealMax = w.falloff.idealMax;
        const rMax = w.falloff.max;
        const gid = `cone-${mech}-${wf.partId}`;
        const ring = annular(rMin, rMax, half);
        if (!ring) return null;

        // Sample the real falloff curve so the cone matches damage exactly.
        const stops = new Set<number>([rMin, rIdealMin, rIdealMax, rMax]);
        if (rIdealMin > rMin) {
          for (let i = 1; i < 4; i++) stops.add(rMin + (rIdealMin - rMin) * (i / 4));
        }
        if (rMax > rIdealMax) {
          for (let i = 1; i < 5; i++) stops.add(rIdealMax + (rMax - rIdealMax) * (i / 5));
        }
        const sampled = [...stops].filter((r) => r >= rMin && r <= rMax).sort((a, b) => a - b);

        return (
          <g key={wf.instanceId} className={`playback-cone${wf.gate === null && wf.status === 'ok' ? ' bearing' : ''}`}>
            <defs>
              <radialGradient
                id={gid}
                gradientUnits="userSpaceOnUse"
                cx={frame.x}
                cy={frame.y}
                r={rMax}
              >
                {rMin > 0 && (
                  <stop offset={Math.max(0, (rMin - 0.01) / rMax)} stopColor={color} stopOpacity={0} />
                )}
                {sampled.map((r) => (
                  <stop
                    key={r}
                    offset={r / rMax}
                    stopColor={color}
                    stopOpacity={Math.max(0, Math.min(1, falloffAt(def, r)))}
                  />
                ))}
              </radialGradient>
            </defs>
            <path d={ring} fill={`url(#${gid})`} className="cone-fill" />
          </g>
        );
      })}
    </g>
  );
}

/**
 * A shot's spread, drawn where it lands. `computeHitModel` returns sigmaM -- the
 * standard deviation of lateral aim error at the target, combining angular
 * dispersion (which grows with range) with lead error (the target's crossing speed
 * times how stale the aim is). Both bars are +/- one and two sigma across the line
 * of sight, against the silhouette half-width the model scores hits on.
 *
 * The point is that the spread is a *measured* consequence of range, your own
 * speed and the target's crossing -- not a fixed cone. Move faster and it widens.
 */
function ShotSpread({ view, frame, tSec, mech, build }: {
  view: BattleView;
  frame: BattleFrame;
  tSec: number;
  mech: 0 | 1;
  build?: Build;
}) {
  const me = frame.mechs[mech];
  const foe = frame.mechs[(1 - mech) as 0 | 1];
  const gun = me.weapons.find((w) => w.status === 'ok' && w.gate === null);
  if (!gun) return null;
  const w = getPart(gun.partId).weapon;
  if (!w) return null;

  const rangeM = Math.hypot(foe.x - me.x, foe.y - me.y);
  if (rangeM < 1) return null;
  const idx = frameIndexAt(view, tSec);
  const prev = idx > 0 ? view.frames[idx - 1] : undefined;
  const mySpeed = prev
    ? Math.hypot(me.x - prev.mechs[mech].x, me.y - prev.mechs[mech].y) / TICK_S
    : 0;
  const lateral = prev ? crossingSpeedMps(prev.mechs[mech], me, foe, TICK_S) : 0;

  // The sim scales both terms by the gun's own modifier and variant multipliers, so
  // a cold-bore or gyrostabilised weapon draws a narrower spread than the catalog
  // number implies. Dropping them made the mark disagree with the shot.
  const placed = build?.parts.find((p) => p.instanceId === gun.instanceId);
  const mults = placed
    ? effectiveMults(placed, { tempC: gun.tempC, speedMps: mySpeed, tile: me.tile })
    : undefined;
  const model = computeHitModel({
    rangeM,
    sigmaRad: weaponSigmaRad({
      dispersionMrad: w.dispersionMrad,
      speedMps: mySpeed,
      mults,
      // A steady frame buys motion jitter down (a Vulture to 0.35), and so do
      // the mech-wide suspension mods. Omitting either drew a moving scout's
      // spread far wider than the shot it marked.
      chassisMoveJitterMult: chassisMoveJitterMultAt(view, build, tSec, mech, {
        speedMps: mySpeed, tile: me.tile,
      }),
    }),
    lateralSpeedMps: lateral,
    lagS: TRACKING_LAG_S,
    // Mech-wide fire control x this weapon's own knob, exactly as the sim does.
    lateralPenaltyMult: fireControlLateralMultAt(view, build, tSec, mech)
      * (mults?.lateralPenalty ?? 1),
    projectileSpeed: w.projectileSpeed,
    // Forest is cover: the sim narrows the target the same way (combat.ts's
    // targetCoverMult). Without it the spread claimed a wider target than the
    // shot was actually scored against, exactly when the enemy was hiding.
    targetHalfWidthM: meanSilhouetteHalfWidthM(getChassis(view.mechs[(1 - mech) as 0 | 1].chassisId))
      * (foe.tile === 'forest' ? FOREST_COVER_MULT : 1),
  });

  // Perpendicular to the line of sight: the axis the error is measured on.
  const px = -(foe.y - me.y) / rangeM;
  const py = (foe.x - me.x) / rangeM;
  const bar = (n: number, cls: string) => (
    <line
      key={cls}
      x1={foe.x - px * model.sigmaM * n} y1={foe.y - py * model.sigmaM * n}
      x2={foe.x + px * model.sigmaM * n} y2={foe.y + py * model.sigmaM * n}
      className={cls}
      stroke={MECH_COLORS[mech]}
    />
  );
  return (
    <g className="playback-spread" aria-hidden="true">
      {bar(2, 'spread-2s')}
      {bar(1, 'spread-1s')}
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
  wf, fired, compact, override, onClick,
}: {
  wf: WeaponFrame;
  fired: boolean;
  compact?: boolean;
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
          {formatWeaponRange(def.weapon!.falloff)} · {def.weapon!.mountArcDeg}°
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

/**
 * A horizontal bar for capacitor charge and power draw. Heat used to be one of
 * these, with `marks` drawing its hold and shutdown lines; it is a column now
 * (HeatColumn), and nothing else marked a threshold, so the prop went with it.
 */
function Gauge({
  label, frac, cls, text,
}: {
  label: string;
  frac: number;
  cls: string;
  text: string;
}) {
  return (
    <div className="hud-gauge">
      <span className="hud-gauge-label">{label}</span>
      <span className="hud-gauge-track">
        <span className={`hud-gauge-fill ${cls}`} style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }} />
      </span>
      <span className="hud-gauge-text">{text}</span>
    </div>
  );
}

export function BattleScene({
  view, tSec, names, onArenaOrder, weaponOverrides, onWeaponClick, arenaOverlay, glassOverlay,
  yourBuild, foeBuild, diagnostics, onOpenLog,
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
  /** The opponent's build. Only the diagnostics need it, to apply the target's own
   *  profile modifiers to its silhouette the way the sim does. */
  foeBuild?: Build;
  /** Lay the movement and gunnery diagnostics on the glass (the fx toggle). */
  diagnostics?: boolean;
  /** Tapping the mech opens the log, as it does in the prototype. */
  onOpenLog?: () => void;
  /**
   * HTML laid on the glass, over the arena. For transient state that must not
   * re-lay the cockpit — anything that appears and disappears belongs here rather
   * than in the column, where it would move every instrument below it.
   */
  glassOverlay?: ReactNode;
  /** Your build, for the console's damage widget. Omitted where it is unknown. */
  yourBuild?: Build;
}) {
  const frame = frameAt(view, tSec);

  /**
   * Rounds still in the air. A shot event records when a gun fired, not where its
   * round is, so position is the shooter-to-target line walked at the weapon's own
   * projectileSpeed -- 250 m/s from a rocket pod and 2000 m/s from a rail gun cross
   * the same arena at visibly different rates, which is the whole point of showing
   * them. Hitscan weapons have no flight time and are drawn as beams instead.
   *
   * The window is the round's own flight time rather than a fixed linger, because a
   * slow projectile at long range is airborne far longer than any constant would
   * allow for.
   */
  const projectiles = useMemo(() => {
    const live: {
      key: string; x: number; y: number; dx: number; dy: number;
      mech: 0 | 1; arrived: boolean; age: number; beam: boolean;
      fx: number; fy: number;
    }[] = [];
    for (const e of view.events) {
      if (e.type !== 'shot' || e.tSec > tSec) continue;
      const speed = getPart(e.partId).weapon?.projectileSpeed;
      if (speed === undefined) continue;
      const f = frameAt(view, e.tSec);
      if (!f) continue;
      const foeIdx = (1 - e.mech) as 0 | 1;
      const shooter = f.mechs[e.mech];
      const to = f.mechs[foeIdx];
      // Leave the gun, not the centre mark. Grid "up" is forward and grid x runs
      // across the hull, matching MechGlyph's footprint, so a shoulder mount fires
      // from the shoulder — which is what makes a layout readable in a fight.
      const mount = view.mechs[e.mech].mounts?.[e.instanceId];
      const chassis = getChassis(view.mechs[e.mech].chassisId);
      let from = { x: shooter.x, y: shooter.y };
      if (mount) {
        const fwd = (chassis.height / 2 - mount.y) * CELL_SIZE_M * MECH_MAG;
        const lat = (mount.x - chassis.width / 2) * CELL_SIZE_M * MECH_MAG;
        const c = Math.cos(shooter.facingRad);
        const sn = Math.sin(shooter.facingRad);
        from = { x: shooter.x + c * fwd - sn * lat, y: shooter.y + sn * fwd + c * lat };
      }
      const distM = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / (distM || 1);
      const uy = (to.y - from.y) / (distM || 1);
      const hullM = getChassis(view.mechs[foeIdx].chassisId).height
        * CELL_SIZE_M * MECH_MAG * 0.5;
      /*
       * A miss has to pass *outside* the hull to look like a miss. The old offset
       * was a flat 3.5 m, which at arena scale is a few pixels — every shot read as
       * a hit even though one in five was not, and that is what "I never see a miss"
       * actually was. Sized against the silhouette it went wide of instead, with a
       * deterministic sign and magnitude from the shot's own time so replays match.
       */
      const missM = e.hit
        ? 0
        : (Math.round(e.tSec * 100) % 2 ? 1 : -1)
          * (hullM * 1.4 + 2 + (Math.round(e.tSec * 1000) % 7));

      if (speed === 'hitscan') {
        // A laser is not a round in flight: it is on, then off. Drawn as the whole
        // line at once for the linger window rather than walked along it.
        if (e.tSec <= tSec - BEAM_LINGER_S) continue;
        const endFrac = e.hit ? Math.max(0, distM - hullM) / (distM || 1) : 1;
        live.push({
          key: `${e.mech}:${e.tSec}:${e.instanceId}`,
          x: from.x, y: from.y, dx: ux, dy: uy, mech: e.mech,
          arrived: e.hit, beam: true,
          age: Math.min(1, (tSec - e.tSec) / BEAM_LINGER_S),
          fx: from.x + (to.x - from.x) * endFrac - uy * missM,
          fy: from.y + (to.y - from.y) * endFrac + ux * missM,
        });
        continue;
      }

      const flightS = distM / speed;
      if (flightS <= 0) continue;
      const progress = (tSec - e.tSec) / flightS;
      // A hit stops at the hull, not the centre mark -- a round sliding through the
      // mech it just struck reads as a miss. A miss keeps going and passes to one
      // side, which is what a miss actually looks like.
      const travelFrac = e.hit ? Math.max(0, distM - hullM) / distM : 1 + 24 / distM;
      const overrun = e.hit ? TRACER_LINGER_S / Math.max(flightS, 1e-6) : 0;
      if (progress < 0 || progress > travelFrac + overrun) continue;
      const at = Math.min(progress, travelFrac);
      const arrived = e.hit && progress >= travelFrac;
      const off = missM * Math.min(1, progress);
      live.push({
        // The mech index belongs in the key: instance ids are unique within a
        // build, not across the two in a battle, so two rounds leaving different
        // mechs on the same tick could collide and React would drop one.
        key: `${e.mech}:${e.tSec}:${e.instanceId}`,
        x: from.x + (to.x - from.x) * at - uy * off,
        y: from.y + (to.y - from.y) * at + ux * off,
        dx: ux,
        dy: uy,
        mech: e.mech,
        arrived,
        beam: false,
        fx: 0,
        fy: 0,
        age: arrived ? Math.min(1, (progress - travelFrac) / Math.max(overrun, 1e-6)) : 0,
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
  const yourBodyMax = getChassis(view.mechs[0].chassisId).maxIntegrity;
  const foeBodyMax = getChassis(view.mechs[1].chassisId).maxIntegrity;

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
        <span className="hud-meter" title="Chassis integrity">
          <span className="hud-meter-fill core" style={{ width: `${(100 * Math.max(0, foe.coreHp)) / foeBodyMax}%` }} />
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

        {/* A round is a short line along its own travel, not a dot: a dot has no
            heading, and at 2000 m/s a rail slug crosses several metres per frame,
            so the segment is what the eye can actually follow. On arrival it
            becomes a brief impact mark instead. */}
        {projectiles.map((p) => {
          if (p.beam) {
            // Lasers are drawn as light: the whole line at once, brightest at the
            // instant of firing and gone in a sixth of a second. Walking a "round"
            // along a hitscan path was the wrong picture entirely -- it is a beam
            // that is either on or off, and that is its identity next to a gun
            // whose shells have to be led.
            return (
              <g key={p.key} opacity={1 - p.age * 0.85}>
                <line
                  x1={p.x} y1={p.y} x2={p.fx} y2={p.fy}
                  className={`playback-beam${p.arrived ? ' hit' : ''}`}
                  stroke={MECH_COLORS[p.mech]}
                />
                {p.arrived && (
                  <circle cx={p.fx} cy={p.fy} r={1.6 + p.age * 2.5} className="playback-impact" />
                )}
              </g>
            );
          }
          return p.arrived ? (
            <circle
              key={p.key}
              cx={p.x} cy={p.y} r={1.4 + p.age * 2.2}
              className="playback-round-hit"
              stroke={MECH_COLORS[p.mech]}
              opacity={1 - p.age}
            />
          ) : (
            <line
              key={p.key}
              x1={p.x - p.dx * ROUND_LEN_M} y1={p.y - p.dy * ROUND_LEN_M}
              x2={p.x} y2={p.y}
              className="playback-round"
              stroke={MECH_COLORS[p.mech]}
            />
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
            mech={i}
          />
        ))}
        {/* Your spread only: the enemy's would double the marks on the same target
            and this is about reading your own gunnery. */}
        <ShotSpread view={view} frame={frame} tSec={tSec} mech={0} build={yourBuild} />

        {([0, 1] as const).map((i) => (
          <MechGlyph key={i} frame={frame.mechs[i]} chassisId={view.mechs[i].chassisId} color={MECH_COLORS[i]} />
        ))}
        {arenaOverlay}
      </svg>
      {/* Hover detail, laid on the glass rather than given a slot in the console.
          It used to hold two permanent rows there -- the scarcest space on the
          screen -- to describe an interaction a phone does not have. Absolute, so
          it reserves nothing, and pointer-events: none so it cannot eat a tap. */}
      {glassOverlay}
      {diagnostics && <BattleDiagnostics view={view} frame={frame} tSec={tSec} build={yourBuild} foeBuild={foeBuild} />}
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
              coreFrac={Math.max(0, you.coreHp) / yourBodyMax}
              onOpen={onOpenLog}
            />
          )}
          <div className="con-bars">
            <div className="cbar">
              <span className="cbar-k">Body</span>
              <span className="cbar-t">
                <i className="cbar-f core" style={{ width: `${(100 * Math.max(0, you.coreHp)) / yourBodyMax}%` }} />
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
            {/* Power sits with the other bars rather than in a gauge row of its
                own: there was room under Mass, and the row it used to live in
                cost the console more height than one reading justified. */}
            <div className="cbar tiny">
              <span className="cbar-k">Pwr</span>
              <span className="cbar-t">
                <i
                  className={`cbar-f ${you.demandKw > you.supplyKw ? 'pwr-over' : 'pwr'}`}
                  style={{ width: `${Math.min(100, you.supplyKw > 0 ? (you.demandKw / you.supplyKw) * 100 : 0)}%` }}
                />
              </span>
              <span className="cbar-v">{you.demandKw.toFixed(0)}/{you.supplyKw.toFixed(0)}</span>
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
                override={weaponOverrides?.[wf.instanceId]}
                onClick={onWeaponClick ? () => onWeaponClick(wf.instanceId) : undefined}
              />
            ))}
        </div>


        <div className="hud-gauges">
          {view.mechs[0].capacitorMaxKj > 0 && (
            <Gauge
              label="CAP" frac={you.capacitorKj / view.mechs[0].capacitorMaxKj} cls="cap"
              text={`${you.capacitorKj.toFixed(0)}/${view.mechs[0].capacitorMaxKj} kJ`}
            />
          )}
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
