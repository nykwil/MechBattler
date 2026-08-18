/**
 * The combat arena: two builds fight under autopilot on a flat 2D plane.
 * See docs/03-combat-spec.md. Headless and rendering-free (rule R6) -- a
 * renderer is a playback layer over the tick states / battle report.
 *
 * Shot resolution (spatial sim 2.0): the seeded accuracy model decides whether
 * the mech is hit, then an exposed equipment-cell/chassis ticket is sampled
 * uniformly. A selected stack resolves top-down and surplus enters global body
 * integrity; an ordinary shot never drills into a second equipment cell.
 *
 * Simplifications this pass (extend, don't silently inherit):
 *  - Mount arcs are always centered on chassis forward. Authored location
 *    zones and turret supports can widen them, but side/rear arc centers are
 *    not implemented yet.
 *  - The autopilot's weapon-enable check skips the one-tick brownout preview
 *    (docs/03 §7 item 4) -- it gates on arc, range, and temperature only.
 *  - Locomotion power draw inside Simulation uses the straight-line
 *    load-derated speed, not the arena's instantaneous velocity; a shed
 *    locomotion (brownout) stops the mech entirely rather than throttling.
 *  - No obstacles (v1 arena is a flat rectangle; walls don't block movement,
 *    only spawn distance matters for now).
 */
import type { Build, ChassisSpec, PartDef } from './types.js';
import { getPart } from './catalog.js';
import { getChassis } from './chassis.js';
import { buildOccupancyMap, computeLoadScaledSpeeds, computeMassAndCoG, type LoadScaledSpeeds } from './grid.js';
import { exposedEquipmentTickets, type AttackDirection } from './spatial.js';
import { connectedInstanceIds } from './spatialPower.js';
import {
  INSTANCE_KNOBS, resolveBuildEffects, resolveFireControlLateralMult, resolveSpeedMultiplier,
  type BuildEffects,
} from './buildEffects.js';
import { Simulation, HEAT_FIRE_HOLD_C, type SimCommand, type SimSnapshot, type SpeedSetting } from './simulation.js';
import { computeIdealRangeBand, falloffAt, type IdealRangeBand } from './derivedStats.js';
import { CORE_INSTANCE_ID } from './thermal.js';
import { Pcg32 } from './rng.js';
import {
  generateTerrain, terrainAt, FOREST_COVER_MULT, HILL_RANGE_MULT,
  TERRAIN_SPEED_MULT, WATER_RADIATOR_MULT, type TerrainGrid, type TerrainType,
} from './terrain.js';
import { NEUTRAL_MULTS, STATIC_CTX, effectiveMults, type EffectiveMults } from './modifiers.js';
import { datan2, dcos, dexp, dhypot, dsin } from './dmath.js';

export const CELL_SIZE_M = 0.5;
export const TICK_S = 1 / 20;
export const AUTOPILOT_PERIOD_TICKS = 5; // 4 Hz (docs/03 §7)
export const DEFAULT_TIMEOUT_S = 120;
export const DEFAULT_SPAWN_DISTANCE_M = 160;
/** Arena square (docs/03 §1): 240 m × 240 m with a terrain tile grid (§2).
 *  Walls bound movement -- a kiter has only (arenaLength − spawnDistance)/2
 *  of runway before its back wall, so infinite runaway is impossible. This is
 *  the counter to the runaway-sniper degeneracy: at some point the sniper
 *  must stand and fight. */
export const DEFAULT_ARENA_LENGTH_M = 240;
export const DEFAULT_ARENA_WIDTH_M = 240;
/** @deprecated Kept in the sim hash/API for replay compatibility; live body HP is chassis-authored. */
export const CORE_HP = 50;
export const CHASSIS_INSTANCE_ID = '__chassis__';
export const SURRENDER_DELAY_S = 3;
/**
 * Stagger (docs/03 §3): a hit knocks a mech off balance when its momentum
 * transfer overcomes the mech's inertia -- so stagger scales with damage but
 * resists with mass. A hit staggers when damage / mass(t) ≥ this threshold.
 * At 3.3, a 15-damage hit staggers a ~4.5 t mech (matching the old flat 15
 * threshold), a 3 t Vulture staggers at 10 damage, and a 12 t Bastion needs
 * ~40 -- only railgun-class hits. Heavy = stable gun platform, by physics.
 */
export const STAGGER_DAMAGE_PER_T = 3.3;
/**
 * Tracking lag (docs/03 §5): aim trails the target's bearing by the fire
 * control's latency, so aim error grows with the target's angular velocity
 * across the shooter's line of sight (lateral speed / range). This is what
 * makes speed a defensive stat even for steady movement.
 *
 * Doubled Aug 2026. At 0.3 s the lead-error term was small enough next to
 * dispersion that crossing in front of a gun barely cost it anything: hit rate
 * against a stationary target and against one crossing at walking pace differed
 * by a couple of points, so nobody could see a reason to move. Lag is the right
 * dial for that rather than dispersion, because it multiplies *lateral speed
 * specifically* -- closing straight in still pays nothing, which is the rule
 * this game wanted -- and because it is the one accuracy term hitscan also pays,
 * so a laser is no longer exempt from having to lead a runner.
 */
export const TRACKING_LAG_S = 0.5;

/**
 * The lateral-target penalty is held separate from the shooter's own movement
 * penalty on purpose. Two different things degrade a shot and they have
 * different counters:
 *
 *   - the shooter moving      -> MOVE_JITTER_MRAD_PER_MPS, bought down by the
 *                                chassis (`moveJitterMult`: a Vulture is steady)
 *   - the target moving across -> bought down by fire control, mech-wide via
 *                                `PartDef.fireControlLateralMult` and per-gun via
 *                                `EffectiveMults.lateralPenalty`. Both are
 *                                content-declared and they multiply.
 *
 * They used to be one dial: the targeting computer "reduced fire-control lag",
 * which is also the term projectile time-of-flight rides on, so a TC quietly
 * made slow shells better as well and there was no way to tune leading a runner
 * without also tuning how far a gun could reach. Lag is now a single physical
 * latency and fire control scales the lateral penalty alone.
 *
 * The penalty itself used to be a hardcoded 1-or-0.4 keyed on the literal part
 * id 'U-TC1'. Nothing could bend it, a second computer counted as none, and a
 * per-weapon effect was not expressible at all -- while its twin (`moveJitter`)
 * was a fully composable knob. That asymmetry is what this replaced.
 */

/**
 * Motion jitter (docs/03 §4): moving adds an absolute pointing error scaling
 * with the shooter's actual speed. Because it's additive, precise long-range
 * guns (railgun 1.2 mrad) suffer proportionally far more than brawling guns
 * (MG 8 mrad) — long-range fire wants a stationary platform, and "accuracy
 * while still" is simply zero jitter. Replaces the old flat speed-setting
 * dispersion multipliers.
 *
 * Raised with tracking lag, Aug 2026, and for the same reason from the other
 * side. Making a crossing target hard to hit handed the fastest chassis a free
 * defence: the Vulture skirmisher could orbit at a speed nothing could lead and
 * still shoot as well as a mech standing still, and went to 73% -- over the R4
 * flag -- on that alone. Evasion has to cost the evader its own gunnery, or
 * speed is not a tradeoff, it is just the best stat.
 */
export const MOVE_JITTER_MRAD_PER_MPS = 0.75;

/**
 * A weapon's aim-error standard deviation before the shot-time multipliers
 * (turning, arc edge, stagger), in radians: catalog dispersion scaled by the
 * gun's own modifiers, plus motion jitter scaled by the shooter's speed, its
 * modifiers, and the chassis's steadiness.
 *
 * One function because this expression had been written out four times -- shot
 * resolution, DPS planning, the arena's spread mark, and the diagnostics
 * overlay -- and the two in the UI had already lost the `moveJitterMult` term.
 * A Vulture buys that down to 0.35, so both instruments drew a moving scout's
 * spread almost three times wider on the jitter term than the shot it was
 * marking. That is precisely the drift CLAUDE.md forbids, and keeping the
 * formula in one exported place is what makes it un-driftable rather than
 * merely currently-correct.
 */
export interface WeaponSigmaInputs {
  /** Catalog dispersion, milliradians. */
  dispersionMrad: number;
  /** The shooter's speed, m/s. */
  speedMps: number;
  /** The gun's effective multipliers (`effectiveMults`); omit for neutral. */
  mults?: { dispersionMrad: number; moveJitter: number };
  /** `ChassisSpec.moveJitterMult`; omit for a neutral frame. */
  chassisMoveJitterMult?: number;
}

/**
 * The same figure in milliradians. Shot resolution works in mrad because it
 * still has the turning, arc-edge and stagger multipliers to apply, and routing
 * it through the radian form would introduce a x0.001 / x1000 round trip that
 * is not bit-exact -- which the golden determinism hash would notice.
 */
export function weaponSigmaMrad(inputs: WeaponSigmaInputs): number {
  const m = inputs.mults;
  return inputs.dispersionMrad * (m?.dispersionMrad ?? 1)
    + MOVE_JITTER_MRAD_PER_MPS * inputs.speedMps * (m?.moveJitter ?? 1)
      * (inputs.chassisMoveJitterMult ?? 1);
}

export function weaponSigmaRad(inputs: WeaponSigmaInputs): number {
  return weaponSigmaMrad(inputs) * 0.001;
}

/**
 * Projectile despawn / fire reach equals `falloff.max` (damage is ×0 there).
 * Kept as a named export so the HUD and combat share one bound; historically
 * this was 1.3× a soft `rangeEnd` floor — the curve now hits zero at `max`.
 */
export const WEAPON_REACH_MULT = 1;
/**
 * Approach slants the autopilot may consider instead of walking straight in,
 * in radians (~20, 40, 60 degrees). Crossing fraction is sin(angle), path
 * length cost is 1/cos(angle), so the exchange trades evasion against time
 * under fire.
 */
export const APPROACH_SLANT_RAD = [0.35, 0.7];
/** How far ahead the autopilot projects a maneuver when scoring it. */
export const MANEUVER_HORIZON_S = 2.0;

export interface Vec2 { x: number; y: number }

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => dhypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : { x: 1, y: 0 }; };

/** Abramowitz-Stegun 7.1.26 erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * dexp(-ax * ax);
  return sign * y;
}

export interface HitModelInputs {
  rangeM: number;
  /** Weapon dispersion after all shooter-state multipliers, in radians. */
  sigmaRad: number;
  /** Target speed perpendicular to the line of sight, m/s. */
  lateralSpeedMps: number;
  /** Fire-control latency (TRACKING_LAG_S). */
  lagS: number;
  /**
   * Scales the lateral-target penalty only: the mech's fire control
   * (`Combatant.fireControlLateralMult`) times this weapon's own
   * `EffectiveMults.lateralPenalty`. Defaults to 1 so a caller that models
   * neither gets the ungated penalty.
   */
  lateralPenaltyMult?: number;
  projectileSpeed: number | 'hitscan';
  /** Half of the target's silhouette width projected across the line of sight, meters. */
  targetHalfWidthM: number;
}

export interface HitModel {
  pHit: number;
  /** Total lateral aim-error standard deviation at the target, meters. */
  sigmaM: number;
  /** Aim staleness: tracking lag + projectile time-of-flight, seconds. */
  aimStalenessS: number;
}

/**
 * The stat-based hit model (docs/03 §5): a shot's lateral error at the target
 * combines angular dispersion (grows with range) with aim staleness — the
 * target's lateral speed times (fire-control lag + projectile time-of-flight).
 * Slow projectiles are statistically dodgeable by crossing targets; hitscan
 * weapons only pay the tracking-lag share. Pure and exported so the workshop
 * can chart hit% curves and tests can pin the numbers.
 */
/**
 * The mean silhouette half-width of a chassis, in metres: what a shot has to land
 * within to connect, before cover. Pose is unknown at planning time, so this is the
 * average of the two footprint axes.
 *
 * Exported because the HUD needs the same figure to draw a shot's spread against
 * the target it is measured against, and re-deriving chassis geometry in the UI is
 * exactly the drift this codebase forbids.
 */
export function meanSilhouetteHalfWidthM(chassis: { width: number; height: number }): number {
  return ((chassis.width + chassis.height) / 4) * CELL_SIZE_M;
}

export function computeHitModel(inputs: HitModelInputs): HitModel {
  const tofS = inputs.projectileSpeed === 'hitscan' ? 0 : inputs.rangeM / Math.max(inputs.projectileSpeed, 1);
  const aimStalenessS = inputs.lagS + tofS;
  const dispersionM = inputs.sigmaRad * inputs.rangeM;
  const leadErrorM = inputs.lateralSpeedMps * aimStalenessS * (inputs.lateralPenaltyMult ?? 1);
  const sigmaM = dhypot(dispersionM, leadErrorM);
  const pHit = sigmaM < 1e-9 ? 1 : erf(inputs.targetHalfWidthM / (sigmaM * Math.SQRT2));
  return { pHit, sigmaM, aimStalenessS };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// --- Orders: the four RTS verbs (docs/03 §7) ---------------------------------
//
// Everything that steers a mech in the arena flows through MechOrder — the
// autopilot is just a controller that emits them at 4 Hz. A future interactive
// mode gives the player the same channel (pass a custom Controller, or step
// the Battle manually and call issueOrders between ticks); the sim never knows
// who is giving the orders.

/** `direct` is an explicit point order (manual control); the rest are autopilot labels. */
export type MoveIntent = 'close' | 'retreat' | 'orbit' | 'hold' | 'flee' | 'direct';

export type MechOrder =
  /** Verb 1 — fire control: which weapons are cleared to fire. */
  | { verb: 'weapons'; enabled: Record<string, boolean> }
  /** Verb 2 — movement: a destination plus the intent label (for logs/UI). */
  | { verb: 'move'; intent: MoveIntent; dest: Vec2 | null }
  /** Verb 3 — throttle: the speed setting (dispersion/heat trade, docs/03 §4). */
  | { verb: 'throttle'; setting: SpeedSetting }
  /** Verb 4 — facing: track the enemy, or hold a fixed bearing. */
  | { verb: 'face'; mode: 'target' } | { verb: 'face'; mode: 'bearing'; bearingRad: number };

export interface ControllerContext {
  self: Combatant;
  enemy: Combatant;
  snapshot: SimSnapshot | null;
  tSec: number;
  terrain: TerrainGrid;
  /** The tick about to run (0-based). Added for lockstep cadence (docs/11 M2). */
  tick: number;
}

/** Decides a mech's orders each command tick (4 Hz). The autopilot is one of these. */
export type Controller = (ctx: ControllerContext) => MechOrder[];

// --- Battle events / report -------------------------------------------------

export interface ShotResolution {
  hit: boolean;
  /** Stack layers damaged in order; `__chassis__` is global body integrity. */
  damaged: { instanceId: string; partId: string; damage: number }[];
  entryCell?: { x: number; y: number };
  targetKind?: 'equipment' | 'chassis';
}

export type BattleEvent =
  | { tSec: number; type: 'shot'; mech: 0 | 1; instanceId: string; partId: string; hit: boolean; totalDamageDealt: number; entryCell?: { x: number; y: number }; damaged?: { instanceId: string; partId: string; damage: number }[] }
  | { tSec: number; type: 'part-destroyed'; mech: 0 | 1; instanceId: string; partId: string; cause: 'damage' | 'heat' | 'cookoff' }
  | { tSec: number; type: 'shed'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'shutdown'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'cookoff'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'surrender-countdown'; mech: 0 | 1 }
  /** A verb changed meaningfully (intent/setting/enable-set), not every 4 Hz re-issue. */
  | { tSec: number; type: 'order'; mech: 0 | 1; order: MechOrder }
  | { tSec: number; type: 'victory'; winner: 0 | 1 | 'draw'; reason: VictoryReason };

export type VictoryReason = 'chassis-failure' | 'core-kill' | 'mission-kill' | 'judges';

/** One weapon's fire-control state in a playback tick (HUD ability-bar data). */
export interface WeaponFrame {
  instanceId: string;
  partId: string;
  /** 0..1 progress toward the next shot (cycle / charge / capacitor fill). */
  readyFrac: number;
  /** Cleared to fire by the current weapons order. */
  enabled: boolean;
  status: 'ok' | 'shed' | 'shutdown' | 'destroyed';
  /** Hottest cell of the part, °C. */
  tempC: number;
  /**
   * Which fire-control gate would silence this gun right now (docs/09 M2):
   * target outside the mount arc, beyond the despawn bound, inside the gun's
   * own minimum range, or the part at or past the 115 °C hold line. Physical
   * facts only — the sim never knows whether the current hold is fire control
   * or a commander (rule R6); the HUD combines this with its own override
   * state. null = clear to fire.
   *
   * `minrange` mirrors the autopilot's `falloffAt(...) > 0` check. It was
   * missing here, so a W-MG inside its 10 m floor was silenced by the sim
   * while the frame reported nothing was stopping it — the readout said
   * "Ready" about a gun that could not fire.
   */
  gate: 'arc' | 'range' | 'minrange' | 'heat' | null;
}

/** One mech's kinematic + status sample for a playback tick. */
export interface MechFrame {
  x: number;
  y: number;
  facingRad: number;
  speedSetting: SpeedSetting;
  coreHp: number;
  functionalMassFrac: number;
  weapons: WeaponFrame[];
  /** Hottest cell anywhere on the mech, °C (the HUD heat gauge). */
  hottestCellC: number;
  /** Pooled capacitor charge, kJ (capacity is MechReport.capacitorMaxKj). */
  capacitorKj: number;
  supplyKw: number;
  demandKw: number;
  /** Standing orders, for the HUD verb readouts and the destination marker. */
  moveIntent: MoveIntent;
  faceMode: 'target' | 'bearing';
  dest: Vec2 | null;
  /** Terrain tile the mech is standing on (HUD chip + effects readout). */
  tile: TerrainType;
}

export interface BattleFrame {
  tSec: number;
  mechs: [MechFrame, MechFrame];
}

export interface MechReport {
  chassisId: string;
  /** Total capacitor capacity of the build, kJ (0 = no capacitors; hide the gauge). */
  capacitorMaxKj: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  partsLost: { instanceId: string; partId: string }[];
  /**
   * Every part's remaining HP as a fraction of its pristine catalog HP
   * (0 = destroyed). Starts at the part's salvage integrity and reflects all
   * damage sources — shots, heat, cook-off splash — so salvage reads final
   * condition directly instead of re-tallying shot events (docs/04 §2).
   */
  partsFinalHp: { instanceId: string; partId: string; hpFrac: number }[];
  /** Functional part mass remaining / total part mass, for judges' decisions (docs/03 §1). */
  functionalMassFrac: number;
  coreHpRemaining: number;
  chassisIntegrityRemaining: number;
  chassisIntegrityMax: number;
  chassisIntegrityFrac: number;
}

export interface BattleReport {
  seed: number;
  durationS: number;
  winner: 0 | 1 | 'draw';
  reason: VictoryReason;
  mechs: [MechReport, MechReport];
  events: BattleEvent[];
  arena: { lengthM: number; widthM: number };
  terrain: TerrainGrid;
  /** Per-tick playback samples (empty when recordFrames was false). */
  frames: BattleFrame[];
}

// --- Combatant ---------------------------------------------------------------

/**
 * One mech in the arena: kinematic state + the power/heat Simulation + HP and
 * wreck bookkeeping. Local grid convention: grid row 0 is the mech's front
 * (docs/01 §1 "grid up is forward"); +forward in world space is the facing
 * direction, +right is starboard.
 */
export class Combatant {
  readonly chassis: ChassisSpec;
  readonly build: Build;
  readonly sim: Simulation;
  readonly band: IdealRangeBand;
  readonly speeds: LoadScaledSpeeds;
  readonly totalPartMassKg: number;

  pos: Vec2;
  vel: Vec2 = { x: 0, y: 0 };
  facingRad: number;
  speedSetting: SpeedSetting = 'cruise';
  destination: Vec2 | null = null;
  moveIntent: MoveIntent = 'hold';
  faceOrder: Extract<MechOrder, { verb: 'face' }> = { verb: 'face', mode: 'target' };
  weaponsEnabled: Record<string, boolean> = {};
  staggerUntilS = -1;
  staggerDispersionUntilS = -1;
  /**
   * Orbit / approach-slant sign (docs/03 §7 verb 3). Seeded per combatant so
   * both sides don't hard-code the same +y detour — with a fixed +1 the player's
   * close destination always swung down-screen even in a mirror matchup.
   */
  orbitDir: 1 | -1 = 1;
  /** Actual turn rate last tick, for the >45 deg/s dispersion penalty (docs/03 §5). */
  lastTurnRateRadS = 0;

  /** Kept as `coreHp` in playback for format compatibility; now body integrity. */
  coreHp: number;
  hpByInstance = new Map<string, number>();
  private heatDamageSeen = new Map<string, number>();
  private occupancy: ReturnType<typeof buildOccupancyMap>;
  /** Weapon-toggle latency per instance (docs/04 §4 Sticky). */
  private orderLatencyById = new Map<string, number>();
  private pendingWeaponToggles = new Map<string, { value: boolean; atS: number }>();
  /** Parts that, while functional, void terrain speed penalties (Marsh pistons). */
  private terrainImmuneIds: string[] = [];
  /** Powered Stride instances; the best one applies, copies never multiply. */
  private speedBoosterIds: string[] = [];

  constructor(build: Build, pos: Vec2, facingRad: number) {
    this.build = build;
    this.chassis = getChassis(build.chassisId);
    this.sim = new Simulation(this.chassis, build);
    this.band = computeIdealRangeBand(build);
    this.speeds = computeLoadScaledSpeeds(this.chassis, computeMassAndCoG(this.chassis, build.parts, build.routes));
    this.pos = pos;
    this.facingRad = facingRad;
    this.occupancy = buildOccupancyMap(build.parts);
    this.coreHp = this.chassis.maxIntegrity * Math.max(0, Math.min(1, build.chassisIntegrity ?? 1));
    const connected = connectedInstanceIds(this.chassis, build);
    let partMass = 0;
    for (const p of build.parts) {
      const def = getPart(p.partId);
      const staticM = effectiveMults(p, STATIC_CTX);
      this.hpByInstance.set(p.instanceId, def.hp * p.integrity * staticM.hp);
      this.heatDamageSeen.set(p.instanceId, 0);
      partMass += def.massKg * staticM.massKg;
      if (staticM.orderLatencyS > 0) this.orderLatencyById.set(p.instanceId, staticM.orderLatencyS);
      if (staticM.ignoreTerrainSlow && connected.has(p.instanceId)) this.terrainImmuneIds.push(p.instanceId);
      if ((def.speedMult ?? 1) > 1 && connected.has(p.instanceId)) this.speedBoosterIds.push(p.instanceId);
    }
    this.totalPartMassKg = partMass;
  }

  /**
   * Weapon-toggle write path with Sticky latency (docs/04 §4): a changed
   * toggle on a latent weapon holds the old state and lands `latency` later.
   */
  commandWeapons(enabled: Record<string, boolean>, tSec: number): void {
    const next = { ...enabled };
    for (const [id, latency] of this.orderLatencyById) {
      const want = next[id] === true;
      const cur = this.weaponsEnabled[id] === true;
      if (want !== cur) {
        const pending = this.pendingWeaponToggles.get(id);
        if (!pending || pending.value !== want) {
          this.pendingWeaponToggles.set(id, { value: want, atS: tSec + latency });
        }
        next[id] = cur;
      } else {
        this.pendingWeaponToggles.delete(id);
      }
    }
    this.weaponsEnabled = next;
  }

  /** Lands due Sticky toggles. Called every tick by the battle loop. */
  flushPendingToggles(tSec: number): void {
    for (const [id, pending] of this.pendingWeaponToggles) {
      if (tSec >= pending.atS) {
        this.weaponsEnabled[id] = pending.value;
        this.pendingWeaponToggles.delete(id);
      }
    }
  }

  /** True while a functional part voids terrain slowdowns (Marsh pistons). */
  ignoresTerrainSlow(snapshot: SimSnapshot | null): boolean {
    return this.terrainImmuneIds.some((id) =>
      this.isPartFunctional(id) &&
      (snapshot === null || (
        !snapshot.shedInstanceIds.includes(id) &&
        !snapshot.shutdownInstanceIds.includes(id)
      )),
    );
  }

  /** Load-scaled speeds with one functional, powered booster applied. */
  activeSpeeds(snapshot: SimSnapshot | null): LoadScaledSpeeds {
    const boost = resolveSpeedMultiplier(this.build.parts, (instanceId) =>
      this.speedBoosterIds.includes(instanceId) &&
      this.isPartFunctional(instanceId) &&
      (snapshot === null || (
        !snapshot.shedInstanceIds.includes(instanceId) &&
        !snapshot.shutdownInstanceIds.includes(instanceId)
      )),
    );
    return boost === 1 ? this.speeds : {
      ...this.speeds,
      fwd: this.speeds.fwd * boost,
      strafe: this.speeds.strafe * boost,
      rev: this.speeds.rev * boost,
    };
  }

  get massT(): number { return this.sim.massT; }

  forward(): Vec2 { return { x: dcos(this.facingRad), y: dsin(this.facingRad) }; }
  right(): Vec2 { return { x: dsin(this.facingRad), y: -dcos(this.facingRad) }; }

  isPartFunctional(instanceId: string): boolean {
    return !this.sim.isDestroyed(instanceId);
  }

  /** Remaining HP / pristine catalog HP (0 when destroyed). */
  partHpFrac(instanceId: string, partId: string): number {
    if (!this.isPartFunctional(instanceId)) return 0;
    return (this.hpByInstance.get(instanceId) ?? 0) / Math.max(getPart(partId).hp, 1);
  }

  /** Dynamic modifier mults for one of this mech's parts (docs/04 §4b). */
  partMults(instanceId: string, tile: TerrainType): Readonly<EffectiveMults> {
    const p = this.build.parts.find((x) => x.instanceId === instanceId);
    if (!p || (!p.modifiers?.length && !p.variant)) return NEUTRAL_MULTS;
    return effectiveMults(p, { tempC: this.sim.meanCellC(instanceId), speedMps: len(this.vel), tile });
  }

  /**
   * The mech's target-profile multiplier (docs/04 §4b, e.g. Hull-down): the
   * product of functional parts' contributions, read against this mech's own
   * physical state.
   *
   * `atSpeedMps` overrides the current velocity for planning. The autopilot
   * scores standing still against orbiting by asking what each would cost, and
   * with the live velocity substituted in, a moving Hull-down mech evaluated
   * standing still *while still counting itself as moving* — so it never saw
   * the ×0.4 profile that stopping buys, and the perk it is built around was
   * active in 3% of sampled ticks. Planning must price the candidate, not the
   * present.
   */
  profileMult(tile: TerrainType, atSpeedMps?: number): number {
    return this.partMultProduct('targetProfile', tile, atSpeedMps);
  }

  /**
   * Mech-wide multiplier on the shooter's own-motion aim jitter (docs/04 §4b,
   * e.g. Coil-sprung actuators / Weaving gait): the product of functional
   * parts' `mechMoveJitter` contributions. Same shape as `profileMult` and
   * for the same reason -- the chassis's baked-in `moveJitterMult` is the
   * frame's inherent steadiness; this is what a build adds on top of it.
   *
   * `atSpeedMps` overrides the current velocity for planning, same as
   * `profileMult` -- `estimateExpectedDps` prices the candidate speed being
   * scored, not whatever the mech happens to be doing this tick.
   */
  mechMoveJitterMult(tile: TerrainType, atSpeedMps?: number): number {
    return this.partMultProduct('mechMoveJitter', tile, atSpeedMps);
  }

  /**
   * Mech-wide multiplier on the fast-turn dispersion spike's excess (docs/03
   * §5, docs/04 §4b Gyro flywheel). Only consulted at shot resolution against
   * the mech's actual recent turn rate -- planning doesn't know a future
   * maneuver's turn rate, so there is no `atSpeedMps`-style override here.
   */
  turnJitterMult(tile: TerrainType): number {
    return this.partMultProduct('turnJitter', tile, len(this.vel));
  }

  /**
   * Shared shape behind `profileMult`, `mechMoveJitterMult` and
   * `turnJitterMult`: the product of every functional, powered part's
   * contribution to one mech-wide `EffectiveMults` field, read against a
   * given speed (the mech's own, or a planning candidate).
   */
  private partMultProduct(field: 'targetProfile' | 'mechMoveJitter' | 'turnJitter', tile: TerrainType, atSpeedMps?: number): number {
    const speedMps = atSpeedMps ?? len(this.vel);
    let mult = 1;
    for (const p of this.build.parts) {
      if (!p.modifiers?.length || !this.isPartFunctional(p.instanceId)) continue;
      const runtime = this.sim.instanceRuntime.get(p.instanceId);
      if (runtime?.isShed || runtime?.isShutdown) continue;
      mult *= effectiveMults(p, { tempC: this.sim.meanCellC(p.instanceId), speedMps, tile })[field];
    }
    return mult;
  }

  /**
   * The mech-wide share of the lateral-target penalty: the product of every
   * functional, powered part's `fireControlLateralMult`.
   *
   * Was a boolean keyed on the literal id 'U-TC1', which made the penalty the
   * one accuracy term no content could bend — no per-gun scope, no stacking, and
   * a second fire-control part would have meant editing the engine. Same shape
   * as `profileMult` below, and for the same reason: the parts declare the
   * effect, the combatant only multiplies what is currently working.
   */
  fireControlLateralMult(snapshot: SimSnapshot | null): number {
    return resolveFireControlLateralMult(this.build.parts, (instanceId) =>
      this.isPartFunctional(instanceId)
      && (snapshot === null || (
        !snapshot.shedInstanceIds.includes(instanceId)
        && !snapshot.shutdownInstanceIds.includes(instanceId)
      )));
  }

  hasFunctionalWeapons(): boolean {
    return this.build.parts.some(
      (p) => getPart(p.partId).category === 'weapon' && this.isPartFunctional(p.instanceId),
    );
  }

  weaponArcDeg(instanceId: string, baseArcDeg: number): number {
    const bonus = this.gatedEffects().byInstance.get(instanceId)?.weaponArcBonusDeg
      ?? INSTANCE_KNOBS.weaponArcBonusDeg.neutral;
    return Math.min(360, baseArcDeg + bonus);
  }

  /** Is this instance contributing right now? The gating every gated knob shares. */
  private isContributing(instanceId: string): boolean {
    if (!this.isPartFunctional(instanceId)) return false;
    const runtime = this.sim.instanceRuntime.get(instanceId);
    return !runtime?.isShed && !runtime?.isShutdown;
  }

  /**
   * Effects resolved against live gating, recomputed only when the gating
   * actually changes.
   *
   * Gating flips in about ten places across a tick -- brownout shedding,
   * thermal shutdown and restart, destruction -- so an invalidation protocol
   * threaded through all of them would be one missed call away from a stale
   * arc. Instead the fingerprint is recomputed per call and the resolve is
   * skipped when it matches: O(parts) against O(parts x cells x stack), which
   * is the same answer the per-call walk gave, an order of magnitude cheaper,
   * and impossible to invalidate wrongly.
   */
  private gatedCache: BuildEffects | null = null;
  private gatedFingerprint = -1;

  private gatedEffects(): BuildEffects {
    let fingerprint = 0;
    for (const p of this.build.parts) {
      fingerprint = ((fingerprint * 31) + (this.isContributing(p.instanceId) ? 1 : 0)) | 0;
    }
    if (this.gatedCache === null || fingerprint !== this.gatedFingerprint) {
      this.gatedCache = resolveBuildEffects(
        this.chassis, this.build, (id) => this.isContributing(id),
      );
      this.gatedFingerprint = fingerprint;
    }
    return this.gatedCache;
  }

  /**
   * Resolver output with every part treated as contributing.
   *
   * Only safe for knobs whose sources are gating-independent -- today that is
   * `weaponRangeMultiplier` alone, which comes from the chassis zone a part sits
   * wholly inside and so cannot change while the fight runs. Arc and heat mix in
   * per-cell sources from supports and armour that DO drop out when those parts
   * are destroyed or shed, and must not be read from here.
   */
  private ungatedEffects: BuildEffects | null = null;

  weaponRangeMultiplier(instanceId: string): number {
    this.ungatedEffects ??= resolveBuildEffects(this.chassis, this.build, () => true);
    return this.ungatedEffects.byInstance.get(instanceId)?.weaponRangeMultiplier
      ?? INSTANCE_KNOBS.weaponRangeMultiplier.neutral;
  }

  functionalMassFrac(): number {
    if (this.totalPartMassKg <= 0) return 1;
    let functional = 0;
    for (const p of this.build.parts) {
      if (this.isPartFunctional(p.instanceId)) functional += getPart(p.partId).massKg;
    }
    return functional / this.totalPartMassKg;
  }

  hottestCellC(instanceId: string, snapshot: SimSnapshot): number {
    let max = 0;
    for (const key of this.sim.thermal.cellKeysByInstance.get(instanceId) ?? []) {
      const t = snapshot.cellTempsC[key];
      if (t !== undefined && t > max) max = t;
    }
    return max;
  }

  /** Half of this mech's silhouette width projected onto the axis perpendicular to a line of sight. */
  projectedHalfWidthM(losDir: Vec2): number {
    const perp: Vec2 = { x: -losDir.y, y: losDir.x };
    const fwd = this.forward();
    const rgt = this.right();
    const halfLen = (this.chassis.height * CELL_SIZE_M) / 2;
    const halfWid = (this.chassis.width * CELL_SIZE_M) / 2;
    return halfLen * Math.abs(fwd.x * perp.x + fwd.y * perp.y) + halfWid * Math.abs(rgt.x * perp.x + rgt.y * perp.y);
  }

  /** Speed component perpendicular to a line of sight (the "crossing" speed a shooter must track). */
  lateralSpeedMps(losDir: Vec2): number {
    const perp: Vec2 = { x: -losDir.y, y: losDir.x };
    return Math.abs(this.vel.x * perp.x + this.vel.y * perp.y);
  }

  /** World-space center of a grid cell. */
  cellCenterWorld(gx: number, gy: number): Vec2 {
    const cx = (this.chassis.width - 1) / 2;
    const cy = (this.chassis.height - 1) / 2;
    const forwardM = (cy - gy) * CELL_SIZE_M;
    const rightM = (gx - cx) * CELL_SIZE_M;
    return add(this.pos, add(scale(this.forward(), forwardM), scale(this.right(), rightM)));
  }

  /**
   * Applies damage to a specific part (heat damage, cook-off splash).
   * Returns true if this call destroyed the part.
   */
  damagePart(instanceId: string, damage: number): boolean {
    const hp = this.hpByInstance.get(instanceId);
    if (hp === undefined || !this.isPartFunctional(instanceId) || damage <= 0) return false;
    const remaining = hp - damage;
    this.hpByInstance.set(instanceId, Math.max(0, remaining));
    if (remaining <= 0) {
      this.sim.destroyPart(instanceId);
      return true;
    }
    return false;
  }

  private attackDirection(dirWorld: Vec2): AttackDirection {
    const dForward = dirWorld.x * this.forward().x + dirWorld.y * this.forward().y;
    const dRight = dirWorld.x * this.right().x + dirWorld.y * this.right().y;
    if (Math.abs(dForward) >= Math.abs(dRight)) return dForward < 0 ? 'front' : 'rear';
    return dRight > 0 ? 'left' : 'right';
  }

  private damageChassis(damage: number, damaged: ShotResolution['damaged']): void {
    if (damage <= 0 || this.coreHp <= 0) return;
    const dealt = Math.min(this.coreHp, damage);
    this.coreHp -= dealt;
    damaged.push({ instanceId: CHASSIS_INSTANCE_ID, partId: CHASSIS_INSTANCE_ID, damage: dealt });
  }

  /**
   * Uniform exposed-face sampling. Accuracy decides whether the mech is hit;
   * this chooses one visible equipment cell or one authored chassis ticket.
   * Equipment overkill resolves the selected stack and then the chassis only.
   */
  applySpatialHit(dirWorld: Vec2, damage: number, ticketRoll: number): ShotResolution {
    const direction = this.attackDirection(dirWorld);
    const equipment = exposedEquipmentTickets(
      this.chassis,
      this.build,
      direction,
      (instanceId) => this.isPartFunctional(instanceId),
    );
    const totalTickets = equipment.length + this.chassis.chassisHitTickets;
    if (totalTickets <= 0) return { hit: false, damaged: [] };
    const selected = Math.min(totalTickets - 1, Math.floor(ticketRoll * totalTickets));
    const damaged: ShotResolution['damaged'] = [];

    if (selected >= equipment.length) {
      this.damageChassis(damage, damaged);
      return { hit: true, damaged, targetKind: 'chassis' };
    }

    const ticket = equipment[selected]!;
    let remaining = damage;
    for (const instanceId of ticket.stackInstanceIds) {
      if (remaining <= 0 || !this.isPartFunctional(instanceId)) continue;
      const placed = this.build.parts.find((part) => part.instanceId === instanceId);
      if (!placed) continue;
      const hp = this.hpByInstance.get(instanceId) ?? 0;
      const dealt = Math.min(hp, remaining);
      this.hpByInstance.set(instanceId, hp - dealt);
      damaged.push({ instanceId, partId: placed.partId, damage: dealt });
      remaining -= dealt;
      if (hp - dealt <= 0) this.sim.destroyPart(instanceId);
      else {
        remaining = 0;
        break;
      }
    }
    // No traversal into another equipment cell. Surplus tears into the body.
    this.damageChassis(remaining, damaged);
    return {
      hit: true,
      damaged,
      entryCell: { x: ticket.cell.x, y: ticket.cell.y },
      targetKind: 'equipment',
    };
  }

  /**
   * Legacy penetration resolver retained for historical replay/unit coverage.
   * Live combat calls applySpatialHit instead.
   *
   * Resolves a world-space ray (a shot that intersected this mech) into
   * locational damage per docs/01 §5 and docs/03 §6: entry cell on the struck
   * perimeter, occupant takes the damage, overkill penetrates inward along
   * the travel line at 50%, wreck cells absorb 25%, empty mask holes pass
   * damage through untouched.
   */
  applyRay(originWorld: Vec2, dirWorld: Vec2, damage: number, carryFrac = 0.5): ShotResolution {
    const fwd = this.forward();
    const rgt = this.right();
    const rel = sub(originWorld, this.pos);
    // Local coords: f = meters along forward axis, r = meters along right axis.
    const oF = rel.x * fwd.x + rel.y * fwd.y;
    const oR = rel.x * rgt.x + rel.y * rgt.y;
    const dF = dirWorld.x * fwd.x + dirWorld.y * fwd.y;
    const dR = dirWorld.x * rgt.x + dirWorld.y * rgt.y;

    const halfLen = (this.chassis.height * CELL_SIZE_M) / 2; // forward axis
    const halfWid = (this.chassis.width * CELL_SIZE_M) / 2; // right axis

    // Slab test against the oriented bounding box.
    let tMin = -Infinity;
    let tMax = Infinity;
    for (const [o, d, half] of [[oF, dF, halfLen], [oR, dR, halfWid]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (Math.abs(o) > half) return { hit: false, damaged: [] };
      } else {
        const t1 = (-half - o) / d;
        const t2 = (half - o) / d;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
    }
    if (tMax < Math.max(tMin, 0)) return { hit: false, damaged: [] };
    const tEnter = Math.max(tMin, 0);

    // Entry point in local meters -> grid coordinates (grid y grows rearward).
    const cx = (this.chassis.width - 1) / 2;
    const cy = (this.chassis.height - 1) / 2;
    const entryF = oF + dF * tEnter;
    const entryR = oR + dR * tEnter;
    // Continuous grid coords (cell centers at integers).
    let gx = cx + entryR / CELL_SIZE_M;
    let gy = cy - entryF / CELL_SIZE_M;
    const stepX = dR / CELL_SIZE_M;
    const stepY = -dF / CELL_SIZE_M;
    const stepLen = dhypot(stepX, stepY);
    const sx = stepX / stepLen;
    const sy = stepY / stepLen;

    // Walk the travel line in half-cell increments, visiting each cell once.
    const damaged: ShotResolution['damaged'] = [];
    let remaining = damage;
    let entryCell: { x: number; y: number } | undefined;
    const visited = new Set<string>();
    const destroyedThisRay = new Set<string>();
    const maxSteps = (this.chassis.width + this.chassis.height) * 2 + 4;
    for (let i = 0; i <= maxSteps && remaining > 0.05; i++) {
      const px = Math.round(gx) + 0; // + 0 normalizes Math.round's -0
      const py = Math.round(gy) + 0;
      gx += sx * 0.5;
      gy += sy * 0.5;
      if (px < 0 || px >= this.chassis.width || py < 0 || py >= this.chassis.height) {
        if (visited.size > 0) break; // exited the far side
        continue;
      }
      const key = `${px},${py}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (this.chassis.mask[py]?.[px] !== true) continue; // masked-out hole: passes through

      if (px === this.chassis.coreCell.x && py === this.chassis.coreCell.y) {
        entryCell ??= { x: px, y: py };
        const dealt = Math.min(this.coreHp, remaining);
        this.coreHp -= dealt;
        damaged.push({ instanceId: CORE_INSTANCE_ID, partId: CORE_INSTANCE_ID, damage: dealt });
        remaining = this.coreHp <= 0 ? (remaining - dealt) * carryFrac : 0;
        continue;
      }

      const occupant = this.occupancy.byCell.get(key);
      if (!occupant) continue; // empty in-mask cell

      entryCell ??= { x: px, y: py };
      const wrecked = !this.isPartFunctional(occupant.instanceId) || destroyedThisRay.has(occupant.instanceId);
      if (wrecked) {
        remaining *= 0.75; // wreck cells absorb at 25% effectiveness (docs/01 §5)
        continue;
      }
      const hp = this.hpByInstance.get(occupant.instanceId)!;
      const dealt = Math.min(hp, remaining);
      this.hpByInstance.set(occupant.instanceId, hp - dealt);
      damaged.push({ instanceId: occupant.instanceId, partId: occupant.partId, damage: dealt });
      if (hp - dealt <= 0) {
        destroyedThisRay.add(occupant.instanceId);
        this.sim.destroyPart(occupant.instanceId);
        remaining = (remaining - dealt) * carryFrac; // overkill penetrates (docs/01 §5)
      } else {
        remaining = 0;
      }
    }

    return { hit: damaged.length > 0 || entryCell !== undefined, damaged, entryCell };
  }

  /** Applies newly-accrued heat damage from the power/heat sim. Returns parts destroyed by heat this tick. */
  collectHeatDamage(): { instanceId: string; partId: string }[] {
    const destroyed: { instanceId: string; partId: string }[] = [];
    for (const p of this.build.parts) {
      const rt = this.sim.instanceRuntime.get(p.instanceId);
      if (!rt) continue;
      const seen = this.heatDamageSeen.get(p.instanceId) ?? 0;
      const delta = rt.cumulativeDamageHp - seen;
      if (delta > 0) {
        this.heatDamageSeen.set(p.instanceId, rt.cumulativeDamageHp);
        if (this.damagePart(p.instanceId, delta)) destroyed.push({ instanceId: p.instanceId, partId: p.partId });
      }
    }
    return destroyed;
  }

  /** Edge-adjacent functional neighbors of a part's cells (for cook-off splash). */
  adjacentParts(instanceId: string): Map<string, string> {
    const result = new Map<string, string>();
    const cells = this.occupancy.cellsByInstance.get(instanceId) ?? [];
    for (const c of cells) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = this.occupancy.byCell.get(`${c.x + dx},${c.y + dy}`);
        if (n && n.instanceId !== instanceId) result.set(n.instanceId, n.partId);
      }
    }
    return result;
  }
}

// --- Autopilot ----------------------------------------------------------------

export interface DpsTerrainMods {
  /** Shooter elevation: falloff band + despawn bound scale (hill = 1.25). */
  shooterRangeMult?: number;
  /** Target concealment: silhouette fraction visible (forest = 0.65). */
  targetCoverMult?: number;
  /** Physical tiles let conditional modifiers use the same context in planning and resolution. */
  shooterTile?: TerrainType;
  targetTile?: TerrainType;
}

/**
 * Expected sustained dps of `shooter` against `target` at a hypothetical
 * range and speed pair, under the stat-based hit model (docs/03 §5). This is
 * the autopilot's scoring primitive: it prices exactly the trade the player
 * will later make by hand — moving costs your own accuracy (motion jitter),
 * crossing speed costs the enemy theirs (tracking lag), range costs both
 * (dispersion growth + falloff). Exported so the workshop can chart it.
 */
export function estimateExpectedDps(
  shooter: Combatant, target: Combatant, rangeM: number,
  shooterSpeedMps: number, targetLateralMps: number, snapshot: SimSnapshot | null,
  mods: DpsTerrainMods = {},
  /**
   * The target's own speed under the option being priced, for speed-conditioned
   * profile modifiers. Defaults to its live velocity; the autopilot passes the
   * candidate so that "what if I stopped" is scored as stopped.
   */
  targetSpeedMps?: number,
): number {
  const terrainRangeMult = mods.shooterRangeMult ?? 1;
  const coverMult = mods.targetCoverMult ?? 1;
  const fireControlMult = shooter.fireControlLateralMult(snapshot);
  const lagS = TRACKING_LAG_S;
  // Pose is unknown at planning time; use the mean silhouette half-width.
  const halfWidthM = meanSilhouetteHalfWidthM(target.chassis) * coverMult *
    target.profileMult(mods.targetTile ?? 'open', targetSpeedMps);
  // Loop-invariant, like fireControlMult and halfWidthM above: it is the
  // shooter's own steadiness at this tile and speed, and no weapon changes it.
  // Inside the loop it walked every modified part once per gun.
  const chassisMoveJitterMult = (shooter.chassis.moveJitterMult ?? 1)
    * shooter.mechMoveJitterMult(mods.shooterTile ?? 'open', shooterSpeedMps);
  let dps = 0;
  for (const p of shooter.build.parts) {
    const def = getPart(p.partId);
    if (def.category !== 'weapon' || !shooter.isPartFunctional(p.instanceId)) continue;
    const w = def.weapon!;
    const rangeMult = terrainRangeMult * shooter.weaponRangeMultiplier(p.instanceId);
    if (rangeM > w.falloff.max * WEAPON_REACH_MULT * rangeMult) continue;
    const m = effectiveMults(p, {
      tempC: shooter.sim.meanCellC(p.instanceId),
      speedMps: shooterSpeedMps,
      tile: mods.shooterTile ?? 'open',
    });
    const model = computeHitModel({
      rangeM,
      // Same formula the shot resolution uses. The autopilot decides whether to
      // cross by running this exchange, so if planning and resolution disagree
      // about what movement costs, a frame that can afford to orbit will still
      // choose to stand. Resolution then adds the shot-time multipliers
      // (turning, arc edge, stagger), which planning cannot know.
      sigmaRad: weaponSigmaRad({
        dispersionMrad: w.dispersionMrad,
        speedMps: shooterSpeedMps,
        mults: m,
        chassisMoveJitterMult,
      }),
      lateralSpeedMps: targetLateralMps,
      lagS,
      lateralPenaltyMult: fireControlMult * m.lateralPenalty,
      projectileSpeed: w.projectileSpeed,
      targetHalfWidthM: halfWidthM,
    });
    dps += (model.pHit * w.damage * m.damage * (w.salvoCount ?? 1) * falloffAt(def, rangeM / rangeMult)) /
      (w.cycleS * m.cycleS);
  }
  return dps;
}

/** Terrain modifiers for a shooter standing on `shooterTile` firing at a target on `targetTile`. */
export function terrainDpsMods(shooterTile: TerrainType, targetTile: TerrainType): DpsTerrainMods {
  return {
    shooterRangeMult: shooterTile === 'hill' ? HILL_RANGE_MULT : 1,
    targetCoverMult: targetTile === 'forest' ? FOREST_COVER_MULT : 1,
    shooterTile,
    targetTile,
  };
}

/**
 * The four-verb autopilot (docs/03 §7), evaluated at 4 Hz. Movement is chosen
 * in two steps: (1) scan the standing-exchange curve U(r) = my dps − their
 * dps at each range to find the range that optimizes my weapons' reach and
 * accuracy against theirs; (2) move there, choosing throttle by what speed
 * costs at the current range, and once there choosing stand-still (accuracy)
 * vs orbit (tracking-error defense) by the same exchange arithmetic.
 * Playstyles are emergent chassis+gun physics, not scripts: a spider whose
 * strafe nearly matches its forward speed finds orbiting cheap; a biped's
 * slow reverse makes backpedaling expensive; a sniper's precise gun makes
 * standing still worth the exposure, and its long reach pushes r* far out.
 */
export const autopilotController: Controller = ({ self, enemy, snapshot, terrain }) => {
  const toEnemy = sub(enemy.pos, self.pos);
  const range = len(toEnemy);
  const dir = norm(toEnemy);

  const myTile = terrainAt(terrain, self.pos.x, self.pos.y);
  const enemyTile = terrainAt(terrain, enemy.pos.x, enemy.pos.y);
  const activeSpeeds = self.activeSpeeds(snapshot);
  // Overheating makes a coolant bath worth real dps in the scoring below.
  let hottestC = 25;
  if (snapshot) for (const t of Object.values(snapshot.cellTempsC)) if (t > hottestC) hottestC = t;
  const runningHot = hottestC >= 100;

  // Farthest range at which any functional gun still fires (despawn bound,
  // elevation-extended when standing on a hill).
  let maxReachM = 0;
  for (const p of self.build.parts) {
    const def = getPart(p.partId);
    if (def.category !== 'weapon' || !self.isPartFunctional(p.instanceId)) continue;
    maxReachM = Math.max(
      maxReachM,
      def.weapon!.falloff.max * WEAPON_REACH_MULT * self.weaponRangeMultiplier(p.instanceId),
    );
  }
  if (myTile === 'hill') maxReachM *= HILL_RANGE_MULT;

  const enemyLateralNow = enemy.lateralSpeedMps(dir);
  const enemySpeedNow = len(enemy.vel);
  /** Net expected exchange at range r given my speed/crossing speed, on current tiles. */
  const exchangeAt = (r: number, mySpeedMps: number, myLateralMps: number): number =>
    estimateExpectedDps(self, enemy, r, mySpeedMps, enemyLateralNow, snapshot, terrainDpsMods(myTile, enemyTile)) -
    estimateExpectedDps(enemy, self, r, enemySpeedNow, myLateralMps, null, terrainDpsMods(enemyTile, myTile), mySpeedMps);
  /** Standing exchange if I were positioned at `pos` (its tile's cover/elevation/coolant). */
  const exchangeAtPos = (pos: Vec2): number => {
    const t = terrainAt(terrain, pos.x, pos.y);
    const r = len(sub(enemy.pos, pos));
    let u = estimateExpectedDps(self, enemy, r, 0, enemyLateralNow, snapshot, terrainDpsMods(t, enemyTile)) -
      estimateExpectedDps(enemy, self, r, enemySpeedNow, 0, null, terrainDpsMods(enemyTile, t), 0);
    if (t === 'water' && runningHot) u += 2;
    return u;
  };
  /** Refine an ideal standing point by shopping the 3×3 neighboring tiles for better ground. */
  const halfL = (terrain.cols * terrain.cellSizeM) / 2;
  const halfW = (terrain.rows * terrain.cellSizeM) / 2;
  const pickGround = (ideal: Vec2): Vec2 => {
    let best = ideal;
    let bestU = exchangeAtPos(ideal);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const p: Vec2 = {
          x: Math.max(-halfL + 2, Math.min(halfL - 2, ideal.x + dx * terrain.cellSizeM)),
          y: Math.max(-halfW + 2, Math.min(halfW - 2, ideal.y + dy * terrain.cellSizeM)),
        };
        const u = exchangeAtPos(p);
        if (u > bestU + 1e-9) { bestU = u; best = p; }
      }
    }
    return best;
  };
  /** True when repositioning one tile away beats standing on this ground by a real margin. */
  const betterGroundNearby = (): boolean => {
    const spot = pickGround(self.pos);
    return (spot.x !== self.pos.x || spot.y !== self.pos.y) && exchangeAtPos(spot) > exchangeAtPos(self.pos) + 0.5;
  };

  // --- Verb 2 + 3 ---
  let move: Extract<MechOrder, { verb: 'move' }>;
  let setting: SpeedSetting;
  if (maxReachM === 0) {
    // No functional guns: stop. The mission-kill surrender is already three
    // seconds out, and sprinting away during those three seconds bought
    // nothing and read as the mech running from a fight it had merely lost.
    // Standing still reads as what it is — this one is done. (A disarmed mech
    // ramming instead would be a real feature; the sim has no melee.)
    move = { verb: 'move', intent: 'hold', dest: null };
    setting = 'stationary';
  } else {
    // Scan standing ranges nearest-first; strict improvement keeps the
    // aggressive tie-break (mirror matchups charge instead of stalling).
    // The scan deliberately runs past this mech's own reach: standing off
    // beyond it is what the cold-bore, fever-cycle and hull-down perks are for,
    // and hard-clamping the loop to weapon range killed all three in the
    // diversity stress.
    //
    // But an out-of-reach range cannot be scored at face value. U(r) there is
    // "nobody shoots" — often 0, which beats every losing exchange, so an
    // outgunned brawler read "as far away as possible" as its best standing
    // point and walked backwards for the whole match without firing once. That
    // was 18% of template matchups with one side silent, and all of the
    // close-range archetypes; a player who picked a brawler watched it refuse
    // to fight. The safety is imaginary: a range I cannot shoot from is not one
    // I hold, because the enemy is free to close, so it is worth what the enemy
    // picks — the worst standing exchange on the curve — and not zero. In reach
    // the value is the exchange itself, so a mech that out-ranges its enemy
    // still stands off and shoots.
    const scan: { r: number; u: number; inReach: boolean }[] = [];
    let concedeU = Infinity;
    for (let r = 10; r <= 260; r += 5) {
      const mine = estimateExpectedDps(self, enemy, r, 0, enemyLateralNow, snapshot, terrainDpsMods(myTile, enemyTile));
      const u = mine - estimateExpectedDps(enemy, self, r, enemySpeedNow, 0, null, terrainDpsMods(enemyTile, myTile), 0);
      scan.push({ r, u, inReach: mine > 0 });
      if (u < concedeU) concedeU = u;
    }
    let bestR = 10;
    let bestU = -Infinity;
    for (const s of scan) {
      const u = s.inReach ? s.u : concedeU;
      if (u > bestU + 1e-9) { bestU = u; bestR = s.r; }
    }

    if (Math.abs(range - bestR) > 8) {
      const closing = range > bestR;
      // Transit throttle: speed costs my accuracy now — pay only what the
      // current range says it's worth. (Out of everyone's reach it's free.)
      const transitSpeed = (s: SpeedSetting) => (closing ? activeSpeeds.fwd : activeSpeeds.rev) * SPEED_FRACTION[s];
      setting = exchangeAt(range, transitSpeed('flank'), 0) >= exchangeAt(range, transitSpeed('cruise'), 0) ? 'flank' : 'cruise';
      if (closing) {
        // Straight-in is pure radial motion. Only *lateral* speed creates lead
        // error, so a head-on approach pays the full jitter cost of moving and
        // earns none of the evasion — against anything that can already shoot
        // back it is strictly worse than slanting in. Measured, mechs spent
        // ~84% of a battle transiting like this and were hit at ~100%, which is
        // why closing builds could not trade at all. The same exchange that
        // chooses the range chooses the slant, so a frame only pays the extra
        // path length when the crossing it buys is worth more than the jitter.
        const speedNow = transitSpeed(setting);
        let bestAngleRad = 0;
        let bestApproachU = exchangeAt(range, speedNow, 0);
        // Near-even exchange (mirror guns, same trade either way): a scenic
        // slant only delays contact. Keep the approach on the enemy line so
        // Auto does not send the player down-screen while both sides could
        // already be facing and firing.
        if (Math.abs(bestApproachU) > 0.5) {
          for (const angleRad of APPROACH_SLANT_RAD) {
            const u = exchangeAt(range, speedNow, speedNow * dsin(angleRad));
            if (u > bestApproachU + 1e-9) { bestApproachU = u; bestAngleRad = angleRad; }
          }
        }
        // Straight-in closes on the ideal standing range along the enemy line.
        // Do not pickGround here: shopping neighbouring tiles yanked the first
        // waypoint off-axis (often down-screen) and, with travel-facing, turned
        // the nose with it — the enemy was already shooting before Auto faced
        // them. Terrain shopping waits until we are inside the band.
        const station = sub(enemy.pos, scale(dir, bestR));
        if (bestAngleRad === 0) {
          move = { verb: 'move', intent: 'close', dest: station };
        } else {
          const slant = bestAngleRad * self.orbitDir;
          const cosS = dcos(slant);
          const sinS = dsin(slant);
          const heading = { x: dir.x * cosS - dir.y * sinS, y: dir.x * sinS + dir.y * cosS };
          const travel = Math.max(8, (range - bestR) / Math.max(dcos(bestAngleRad), 0.3));
          move = { verb: 'move', intent: 'close', dest: add(self.pos, scale(heading, travel)) };
        }
      } else {
        // Give ground facing the enemy, never turn tail.
        //
        // There used to be a `flee` branch here for a mech that wanted more
        // distance than it had and could not shoot from where it stood. It
        // turned tail — `flee` sets facing *away* from the target — so it ran
        // at forward speed with its guns unable to bear, and did not shoot for
        // the rest of the match. That was 28% of measured battles, and gating
        // it on outrunning the pursuer only halved it.
        //
        // The behaviour never made sense on its own terms. Breaking contact
        // wins nothing in a run that ends when you lose, and a mech with a
        // reach advantage wants to back off *while shooting*, which is exactly
        // what `retreat` already does: reverse speed, facing held on the
        // target, guns bearing. Turning tail is now reserved for having no
        // functional guns at all, where the surrender clock is running anyway.
        // Same as close: the ideal point stays on the enemy line; terrain
        // shopping waits until we are inside the band.
        move = { verb: 'move', intent: 'retreat', dest: sub(enemy.pos, scale(dir, bestR)) };
      }
    } else if (betterGroundNearby()) {
      // At the chosen range: better ground one tile away — a hill for my
      // guns' reach, forest cover, or a coolant bath when running hot are
      // worth a short reposition inside the band.
      const spot = pickGround(self.pos);
      move = { verb: 'move', intent: len(sub(enemy.pos, spot)) < range ? 'close' : 'retreat', dest: spot };
      setting = 'cruise';
    } else {
      // At the chosen range: stand for accuracy, or orbit to tax the enemy's
      // tracking? Crossing speed costs me jitter and them tracking error —
      // the exchange says whether my guns or theirs are more motion-tolerant.
      const orbitSpeed = (s: SpeedSetting) => activeSpeeds.strafe * SPEED_FRACTION[s];
      const holdU = exchangeAt(range, 0, 0);
      const orbitCruiseU = exchangeAt(range, orbitSpeed('cruise'), orbitSpeed('cruise'));
      const orbitFlankU = exchangeAt(range, orbitSpeed('flank'), orbitSpeed('flank'));
      if (Math.max(orbitCruiseU, orbitFlankU) > holdU) {
        const stepRad = 0.35 * self.orbitDir;
        const cosR = dcos(stepRad);
        const sinR = dsin(stepRad);
        const fromEnemy = scale(dir, -range);
        move = {
          verb: 'move', intent: 'orbit',
          dest: add(enemy.pos, {
            x: fromEnemy.x * cosR - fromEnemy.y * sinR,
            y: fromEnemy.x * sinR + fromEnemy.y * cosR,
          }),
        };
        setting = orbitFlankU >= orbitCruiseU ? 'flank' : 'cruise';
      } else {
        move = { verb: 'move', intent: 'hold', dest: null };
        setting = 'stationary';
      }
    }
  }

  // --- Verb 1: weapons on/off (arc + range + temperature) ---
  const bearingToEnemy = datan2(dir.y, dir.x);
  const bearingOffset = Math.abs(wrapAngle(bearingToEnemy - self.facingRad));
  const enabled: Record<string, boolean> = {};
  for (const p of self.build.parts) {
    const def = getPart(p.partId);
    if (def.category !== 'weapon') continue;
    if (!self.isPartFunctional(p.instanceId)) { enabled[p.instanceId] = false; continue; }
    const halfArc = (self.weaponArcDeg(p.instanceId, def.weapon!.mountArcDeg) / 2) * (Math.PI / 180);
    const inArc = bearingOffset <= halfArc;
    const rangeMultiplier = self.weaponRangeMultiplier(p.instanceId) * (myTile === 'hill' ? HILL_RANGE_MULT : 1);
    const despawnRange = def.weapon!.falloff.max * WEAPON_REACH_MULT * rangeMultiplier;
    const coolEnough = snapshot === null || self.hottestCellC(p.instanceId, snapshot) < HEAT_FIRE_HOLD_C;
    // Don't spend heat and ammo on a shot the curve prices at exactly zero.
    //
    // In practice that is a minimum-range gate for the one gun that authors
    // `falloff.min` -- W-MG, floored at 10 m. Every other gun leaves `min`
    // undefined, so falloffAt ramps from 0 and is positive at any range above
    // literally zero, which resolveBodyCollision makes unreachable: two hulls
    // never come closer than 2.3-4.3 m. A Judge at 3 m therefore fires for 15%
    // damage rather than being silenced, and that graded ramp is the design --
    // a gun inside its band is weak, not useless. (An earlier comment here
    // claimed the reverse, that the gate silenced every non-brawler at contact;
    // it never did, for anything but W-MG.)
    //
    // Range is unscaled back through the same multiplier computeWeaponEnvelope
    // uses so a hill's reach bonus doesn't get read as point-blank.
    enabled[p.instanceId] = inArc && falloffAt(def, range / rangeMultiplier) > 0 && range <= despawnRange && coolEnough;
  }

  // --- Verb 4: face the target when a gun can reach. Out of reach, travel-face
  // along the enemy line (not at a slanted/terrain waypoint) so forward speed
  // closes range and the nose is already on the threat when the gun comes into
  // reach — Auto used to stare at a down-screen detour while the enemy shot.
  let face: Extract<MechOrder, { verb: 'face' }>;
  if (maxReachM === 0) {
    // Nothing left to aim: hold the current bearing rather than claim to be
    // tracking. `mode: 'target'` here would be a lie, and a costly one — the
    // manual merge only re-aims facing at a player's waypoint when the
    // autopilot was travel-facing, so a disarmed mech under manual control
    // would stare at the enemy instead of where it was being driven.
    face = { verb: 'face', mode: 'bearing', bearingRad: self.facingRad };
  } else if (move.intent === 'flee') {
    face = { verb: 'face', mode: 'bearing', bearingRad: datan2(-dir.y, -dir.x) };
  } else if (maxReachM > 0 && range <= maxReachM) {
    face = { verb: 'face', mode: 'target' };
  } else if (move.dest) {
    face = { verb: 'face', mode: 'bearing', bearingRad: bearingToEnemy };
  } else {
    face = { verb: 'face', mode: 'target' };
  }

  return [
    { verb: 'weapons', enabled },
    move,
    { verb: 'throttle', setting: move.dest === null ? 'stationary' : setting },
    face,
  ];
};

/**
 * Standing manual overrides held over a base controller (docs/08 §3): fields
 * left undefined stay on auto. The merge doesn't know who supplies the manual
 * state (rule R6) — the web UI's click handlers and scripted tests use the
 * same path.
 */
export interface ManualOrders {
  /** A point order (logged as intent `direct`), or hold in place. */
  move?: { dest: Vec2 } | 'hold';
  throttle?: SpeedSetting;
  /**
   * Per-weapon fire-control override: `hold` withholds a gun the autopilot
   * would fire; `force` frees one it would gate (arc/range/temperature — the
   * sim's physical shutdown at 130°C still applies; that's physics, not fire
   * control). Weapons absent from the map stay on auto.
   */
  weapons?: Record<string, 'hold' | 'force'>;
  /** Forced facing: track target, face the direction of travel, or hold a bearing. */
  face?: 'movement' | { mode: 'target' } | { mode: 'bearing'; bearingRad: number };
}

/**
 * Wraps a controller so manual verb overrides replace its orders.
 *
 * Had an `onArrival` hook for "reach the waypoint, revert to full auto",
 * removed Aug 2026 along with the cockpit toggle that armed it. Nobody could
 * tell what it did from the button, and a standing order that silently hands
 * the mech back mid-fight is a surprise, not a convenience: control now changes
 * hands only when the player says so.
 */
export function withManualOrders(base: Controller, manual: () => ManualOrders): Controller {
  return (ctx) => mergeManualOrders(base(ctx), manual(), ctx);
}

/**
 * Overlays a player's manual overrides on a base controller's orders (docs/08
 * §3). Pure — the single merge path shared by the live command UI
 * (`withManualOrders`) and the lockstep driver (docs/11 M2), so both produce
 * identical orders from identical inputs.
 */
export function mergeManualOrders(baseOrders: MechOrder[], m: ManualOrders, ctx: ControllerContext): MechOrder[] {
  return baseOrders.map((o): MechOrder => {
    if (o.verb === 'weapons' && m.weapons) {
      const enabled = { ...o.enabled };
      for (const [id, ovr] of Object.entries(m.weapons)) enabled[id] = ovr === 'force';
      return { verb: 'weapons', enabled };
    }
    if (o.verb === 'move' && m.move) {
      return m.move === 'hold'
        ? { verb: 'move', intent: 'hold', dest: null }
        : { verb: 'move', intent: 'direct', dest: m.move.dest };
    }
    if (o.verb === 'throttle') {
      if (m.throttle) return { verb: 'throttle', setting: m.throttle };
      // With move manual but throttle on auto, the autopilot's setting was
      // priced for its own destination: march to a waypoint at cruise, and
      // stand fully still on a hold.
      if (m.move === 'hold') return { verb: 'throttle', setting: 'stationary' };
      if (m.move) return { verb: 'throttle', setting: 'cruise' };
    }
    if (o.verb === 'face') {
      if (m.face) {
        if (m.face === 'movement') {
          const speed = dhypot(ctx.self.vel.x, ctx.self.vel.y);
          return {
            verb: 'face', mode: 'bearing',
            bearingRad: speed > 0.5 ? datan2(ctx.self.vel.y, ctx.self.vel.x) : ctx.self.facingRad,
          };
        }
        return m.face.mode === 'target'
          ? { verb: 'face', mode: 'target' }
          : { verb: 'face', mode: 'bearing', bearingRad: m.face.bearingRad };
      }
      // Move is manual but face is on auto: when the autopilot chose
      // travel-facing (mode bearing — no gun can reach, docs/03 §7.4), its
      // bearing was aimed at its own destination, not the player's waypoint.
      // Re-aim at the manual dest so the mech travels on its (faster)
      // forward speed; target-tracking passes through untouched.
      if (m.move && m.move !== 'hold' && o.mode === 'bearing') {
        const dx = m.move.dest.x - ctx.self.pos.x;
        const dy = m.move.dest.y - ctx.self.pos.y;
        if (dhypot(dx, dy) > 2) {
          return { verb: 'face', mode: 'bearing', bearingRad: datan2(dy, dx) };
        }
      }
      return o;
    }
    return o;
  });
}

/** Applies one order to a combatant's control state. The single write path for all verbs. */
export function applyOrder(self: Combatant, order: MechOrder, tSec = 0): void {
  switch (order.verb) {
    case 'weapons':
      self.commandWeapons(order.enabled, tSec);
      break;
    case 'move':
      self.moveIntent = order.intent;
      self.destination = order.dest;
      break;
    case 'throttle':
      self.speedSetting = order.setting;
      break;
    case 'face':
      self.faceOrder = order;
      break;
  }
}

// --- Movement integration ------------------------------------------------------

/** Max achievable speed moving at `angleOffRad` from facing: an ellipse through fwd/rev and strafe maxima. */
function maxSpeedInDirection(speeds: LoadScaledSpeeds, angleOffRad: number): number {
  const c = dcos(angleOffRad);
  const s = dsin(angleOffRad);
  const axial = c >= 0 ? speeds.fwd : speeds.rev;
  const denom = Math.sqrt((c / Math.max(axial, 0.01)) ** 2 + (s / Math.max(speeds.strafe, 0.01)) ** 2);
  return denom > 1e-9 ? 1 / denom : 0;
}

const SPEED_FRACTION: Record<SpeedSetting, number> = { stationary: 0, creep: 0.3, cruise: 0.65, flank: 1.0 };

function integrateMovement(
  self: Combatant,
  enemy: Combatant,
  locomotionShed: boolean,
  tSec: number,
  dt: number,
  terrainSpeedMult = 1,
  snapshot: SimSnapshot | null = null,
): void {
  // Verb 4: facing per the standing face order (autopilot default: track target).
  const desired = self.faceOrder.mode === 'bearing'
    ? self.faceOrder.bearingRad
    : datan2(enemy.pos.y - self.pos.y, enemy.pos.x - self.pos.x);
  const before = self.facingRad;
  if (tSec >= self.staggerUntilS) {
    const maxTurn = self.speeds.turnRateDegS * (Math.PI / 180) * dt;
    const delta = wrapAngle(desired - self.facingRad);
    self.facingRad = wrapAngle(self.facingRad + Math.max(-maxTurn, Math.min(maxTurn, delta)));
  }
  self.lastTurnRateRadS = wrapAngle(self.facingRad - before) / dt;

  const accel = self.chassis.accelMps2 * self.speeds.loadFactor;
  const activeSpeeds = self.activeSpeeds(snapshot);
  let targetVel: Vec2 = { x: 0, y: 0 };
  if (self.destination && !locomotionShed) {
    const toDest = sub(self.destination, self.pos);
    const dist = len(toDest);
    if (dist > 0.5) {
      const dir = norm(toDest);
      const angleOff = wrapAngle(datan2(dir.y, dir.x) - self.facingRad);
      const maxV = maxSpeedInDirection(activeSpeeds, angleOff) * SPEED_FRACTION[self.speedSetting] * terrainSpeedMult;
      // Slow into the destination so we don't orbit it.
      const arrivalV = Math.sqrt(2 * accel * dist);
      targetVel = scale(dir, Math.min(maxV, arrivalV));
    }
  }
  const dv = sub(targetVel, self.vel);
  const dvLen = len(dv);
  const maxDv = accel * dt;
  self.vel = dvLen <= maxDv ? targetVel : add(self.vel, scale(norm(dv), maxDv));
  self.pos = add(self.pos, scale(self.vel, dt));
}

// --- Battle -------------------------------------------------------------------

/** Total capacitor storage of a build (the CAP gauge's denominator). */
export function buildCapacitorMaxKj(build: Build): number {
  return build.parts.reduce((s, p) => {
    const def = getPart(p.partId);
    return s + (def.category === 'capacitor' ? def.capacitor!.storedKj : 0);
  }, 0);
}

export interface BattleOptions {
  builds: [Build, Build];
  seed: number;
  timeoutS?: number;
  spawnDistanceM?: number;
  arenaLengthM?: number;
  arenaWidthM?: number;
  /** Terrain override; default generates a tile grid from the battle seed. */
  terrain?: TerrainGrid;
  /**
   * Order sources, one per mech (default: the autopilot for both). A future
   * player-controlled mode passes its own Controller — or a no-op controller
   * plus manual issueOrders() calls between steps.
   */
  controllers?: [Controller, Controller];
  /** Record per-tick playback frames in the report (default true; harness runs disable it). */
  recordFrames?: boolean;
  /**
   * Skip the mission-kill surrender check (default false). The workshop range
   * sandbox sets this so its weaponless target dummy stands and takes fire
   * instead of surrendering 3 s in; core-kill and timeout still end the battle.
   */
  suppressSurrender?: boolean;
  /**
   * Lockstep mode (docs/11 M2): the `controllers` are treated as raw autopilot
   * bases refreshed at 4 Hz, while per-mech manual overrides set via
   * `setManualOrders` merge on top and apply EVERY tick (20 Hz player
   * responsiveness). Default false keeps the legacy 4-Hz controller path.
   */
  lockstep?: boolean;
}

export class Battle {
  readonly combatants: [Combatant, Combatant];
  readonly events: BattleEvent[] = [];
  readonly seed: number;
  readonly terrain: TerrainGrid;
  private readonly rng: Pcg32;
  private readonly timeoutS: number;
  private readonly arenaHalfLengthM: number;
  private readonly arenaHalfWidthM: number;
  private tSec = 0;
  private tick = 0;
  private readonly controllers: [Controller, Controller];
  private readonly recordFrames: boolean;
  private readonly suppressSurrender: boolean;
  private readonly lockstepMode: boolean;
  /** Lockstep: last 4-Hz autopilot decision per mech, re-merged with manual every tick. */
  private baseOrders: [MechOrder[], MechOrder[]] = [[], []];
  /** Lockstep: sticky per-mech manual overrides (null = full autopilot). */
  private manual: [ManualOrders | null, ManualOrders | null] = [null, null];
  /** Per-tick playback samples; a live renderer reads the tail while the battle runs. */
  readonly frames: BattleFrame[] = [];
  /** Per-mech, per-verb signature of the last logged order, for change-only logging. */
  private lastOrderSig: [Record<string, string>, Record<string, string>] = [{}, {}];
  private surrenderTimers: [number | null, number | null] = [null, null];
  private lastShed: [Set<string>, Set<string>] = [new Set(), new Set()];
  private lastShutdown: [Set<string>, Set<string>] = [new Set(), new Set()];
  private lastSnapshots: [SimSnapshot | null, SimSnapshot | null] = [null, null];
  private stats = [
    { shotsFired: 0, shotsHit: 0, damageDealt: 0 },
    { shotsFired: 0, shotsHit: 0, damageDealt: 0 },
  ];
  private outcome: { winner: 0 | 1 | 'draw'; reason: VictoryReason } | null = null;

  constructor(options: BattleOptions) {
    this.seed = options.seed;
    this.rng = new Pcg32(options.seed);
    this.timeoutS = options.timeoutS ?? DEFAULT_TIMEOUT_S;
    this.controllers = options.controllers ?? [autopilotController, autopilotController];
    this.recordFrames = options.recordFrames ?? true;
    this.suppressSurrender = options.suppressSurrender ?? false;
    this.lockstepMode = options.lockstep ?? false;
    this.arenaHalfLengthM = (options.arenaLengthM ?? DEFAULT_ARENA_LENGTH_M) / 2;
    this.arenaHalfWidthM = (options.arenaWidthM ?? DEFAULT_ARENA_WIDTH_M) / 2;
    this.terrain = options.terrain ?? generateTerrain(options.seed, this.arenaHalfLengthM * 2, this.arenaHalfWidthM * 2);
    const half = Math.min((options.spawnDistanceM ?? DEFAULT_SPAWN_DISTANCE_M) / 2, this.arenaHalfLengthM - 2);
    // Seeded lateral spawn jitter: without it the autopilots take identical
    // approach lanes every battle and matchup outcomes are nearly binary
    // (docs/07 "knife-edge deterministic" finding). ±20 m across the width
    // varies the geometry battle to battle while staying replayable.
    const jitterMax = Math.min(20, this.arenaHalfWidthM - 5);
    const jitter = () => (this.rng.nextFloat() * 2 - 1) * jitterMax;
    const posA: Vec2 = { x: -half, y: jitter() };
    const posB: Vec2 = { x: half, y: jitter() };
    this.combatants = [
      new Combatant(options.builds[0], posA, datan2(posB.y - posA.y, posB.x - posA.x)),
      new Combatant(options.builds[1], posB, datan2(posA.y - posB.y, posA.x - posB.x)),
    ];
    // Seeded per side so a mirror matchup does not always send the player
    // down-screen (orbitDir was hard-coded +1).
    this.combatants[0].orbitDir = this.rng.nextFloat() < 0.5 ? 1 : -1;
    this.combatants[1].orbitDir = this.rng.nextFloat() < 0.5 ? 1 : -1;
  }

  get finished(): boolean { return this.outcome !== null; }

  /** Sim seconds elapsed. */
  get timeS(): number { return this.tSec; }

  /** The tick that the next `step()` will run (0-based). Lockstep order stamps key off this. */
  get currentTick(): number { return this.tick; }

  /**
   * Set (or clear, with null) a mech's sticky manual override in lockstep mode
   * (docs/11 M2). The override merges over the autopilot base and applies from
   * the next step until replaced. No-op outside lockstep mode.
   */
  setManualOrders(mech: 0 | 1, orders: ManualOrders | null): void {
    this.manual[mech] = orders;
  }

  get arena(): { lengthM: number; widthM: number } {
    return { lengthM: this.arenaHalfLengthM * 2, widthM: this.arenaHalfWidthM * 2 };
  }

  /** The most recent playback frame (null before the first step or with recordFrames off). */
  latestFrame(): BattleFrame | null { return this.frames[this.frames.length - 1] ?? null; }

  /** Runs one 50 ms tick. Returns false once the battle has been decided. */
  step(): boolean {
    if (this.outcome) return false;
    const dt = TICK_S;
    this.tSec += dt;
    const [a, b] = this.combatants;

    const ctx = (i: 0 | 1): ControllerContext => ({
      self: this.combatants[i], enemy: this.combatants[(1 - i) as 0 | 1],
      snapshot: this.lastSnapshots[i], tSec: this.tSec, terrain: this.terrain, tick: this.tick,
    });
    if (!this.lockstepMode) {
      // Legacy path: controllers (which may embed withManualOrders) decide and
      // issue at 4 Hz through the same channel a player would.
      if (this.tick % AUTOPILOT_PERIOD_TICKS === 0) {
        this.issueOrders(0, this.controllers[0](ctx(0)));
        this.issueOrders(1, this.controllers[1](ctx(1)));
      }
    } else {
      // Lockstep (docs/11 M2): autopilot base refreshes at 4 Hz; per-mech
      // manual overrides merge on top and issue EVERY tick, so player inputs
      // land at the full 20 Hz — the 4 Hz cadence is strategy, not input lag.
      if (this.tick % AUTOPILOT_PERIOD_TICKS === 0) {
        this.baseOrders[0] = this.controllers[0](ctx(0));
        this.baseOrders[1] = this.controllers[1](ctx(1));
      }
      for (const i of [0, 1] as const) {
        const m = this.manual[i];
        this.issueOrders(i, m ? mergeManualOrders(this.baseOrders[i], m, ctx(i)) : this.baseOrders[i]);
      }
    }
    this.tick++;

    // Power/heat/weapon-cycle sim per mech, then resolve any shots it produced.
    for (const i of [0, 1] as const) {
      const self = this.combatants[i];
      const enemy = this.combatants[(1 - i) as 0 | 1];
      self.flushPendingToggles(this.tSec); // land due Sticky toggles (docs/04 §4)
      const tile = terrainAt(this.terrain, self.pos.x, self.pos.y);
      const command: SimCommand = {
        weaponsEnabled: self.weaponsEnabled,
        speedSetting: self.speedSetting,
        radiatorMult: tile === 'water' ? WATER_RADIATOR_MULT : 1,
        // Physical context for dynamic modifiers (docs/04 §4b).
        speedMps: len(self.vel),
        tile,
      };
      const snapshot = self.sim.step(dt, command);
      this.lastSnapshots[i] = snapshot;

      this.logTransitions(i, snapshot);

      for (const shot of snapshot.shotsThisTick) {
        this.resolveShot(i, self, enemy, shot.instanceId, shot.partId);
      }

      for (const cook of snapshot.cookoffsThisTick) {
        this.events.push({ tSec: this.tSec, type: 'cookoff', mech: i, instanceId: cook.instanceId });
        // Cook-off destroys the bin and splashes 40 damage across edge-adjacent parts (docs/02 §3).
        const neighbors = self.adjacentParts(cook.instanceId);
        self.sim.destroyPart(cook.instanceId);
        const part = self.build.parts.find((p) => p.instanceId === cook.instanceId)!;
        this.events.push({ tSec: this.tSec, type: 'part-destroyed', mech: i, instanceId: cook.instanceId, partId: part.partId, cause: 'cookoff' });
        // Sacrificial casing (docs/04 §4b): a vented bin splashes nothing.
        const per = neighbors.size > 0 ? (40 * effectiveMults(part, STATIC_CTX).cookoffSplash) / neighbors.size : 0;
        for (const [nid, npid] of neighbors) {
          if (self.damagePart(nid, per)) {
            this.events.push({ tSec: this.tSec, type: 'part-destroyed', mech: i, instanceId: nid, partId: npid, cause: 'cookoff' });
          }
        }
      }

      for (const dead of self.collectHeatDamage()) {
        this.events.push({ tSec: this.tSec, type: 'part-destroyed', mech: i, instanceId: dead.instanceId, partId: dead.partId, cause: 'heat' });
      }
    }

    // Movement, then clamp to the arena walls (a mech pinned against a wall
    // loses the velocity component driving it into the wall -- no sticking).
    for (const i of [0, 1] as const) {
      // Partial locomotion power is a slower mech, not a stopped one; the core
      // only sheds outright when its network can feed it nothing at all.
      const locomotionFrac = this.lastSnapshots[i]?.locomotionPowerFrac ?? 1;
      const locomotionShed = this.lastSnapshots[i]?.shedInstanceIds.includes(CORE_INSTANCE_ID) ?? false;
      const c = this.combatants[i];
      // Marsh pistons (docs/04 §4b): a functional immune part voids the slow.
      const baseMult = TERRAIN_SPEED_MULT[terrainAt(this.terrain, c.pos.x, c.pos.y)];
      const speedMult = (baseMult < 1 && c.ignoresTerrainSlow(this.lastSnapshots[i]) ? 1 : baseMult) * locomotionFrac;
      integrateMovement(c, this.combatants[(1 - i) as 0 | 1], locomotionShed, this.tSec, dt, speedMult, this.lastSnapshots[i]);
      if (c.pos.x < -this.arenaHalfLengthM) { c.pos.x = -this.arenaHalfLengthM; c.vel.x = Math.max(0, c.vel.x); }
      else if (c.pos.x > this.arenaHalfLengthM) { c.pos.x = this.arenaHalfLengthM; c.vel.x = Math.min(0, c.vel.x); }
      if (c.pos.y < -this.arenaHalfWidthM) { c.pos.y = -this.arenaHalfWidthM; c.vel.y = Math.max(0, c.vel.y); }
      else if (c.pos.y > this.arenaHalfWidthM) { c.pos.y = this.arenaHalfWidthM; c.vel.y = Math.min(0, c.vel.y); }
    }
    this.resolveBodyCollision();

    if (this.recordFrames) {
      this.frames.push({
        tSec: this.tSec,
        mechs: [this.sampleMechFrame(a, this.lastSnapshots[0], b), this.sampleMechFrame(b, this.lastSnapshots[1], a)],
      });
    }

    this.checkVictory();
    return this.outcome === null;
  }

  /** Samples the cockpit-visible state of one mech (HUD data, not sim state). */
  private sampleMechFrame(c: Combatant, snap: SimSnapshot | null, enemy: Combatant): MechFrame {
    // Fire-control gate facts, mirroring the autopilot's own weapon check.
    const toEnemy = sub(enemy.pos, c.pos);
    const rangeToEnemy = len(toEnemy);
    const bearingOffset = Math.abs(wrapAngle(datan2(toEnemy.y, toEnemy.x) - c.facingRad));
    const myTile = terrainAt(this.terrain, c.pos.x, c.pos.y);
    const weapons: WeaponFrame[] = [];
    for (const p of c.build.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'weapon') continue;
      const rt = c.sim.instanceRuntime.get(p.instanceId)!;
      const destroyed = !c.isPartFunctional(p.instanceId);
      // Progress toward the next shot, whatever feeds the gun: cycle time
      // (continuous draw), charge (laser), or capacitor dump (railgun).
      // A post-shot cooldown reads as 0 — the bar visibly resets on fire.
      let readyFrac = 0;
      if (!destroyed && !rt.isShutdown) {
        if (def.draw?.continuousKw) readyFrac = Math.min(rt.cycleTimer / def.weapon!.cycleS, 1);
        else if (def.draw?.chargedEnergyPerShotKj) readyFrac = rt.cooldownRemainingS > 0 ? 0 : Math.min(rt.chargeKj / def.draw.chargedEnergyPerShotKj, 1);
        else if (def.draw?.capFedEnergyPerShotKj) readyFrac = rt.cooldownRemainingS > 0 ? 0 : Math.min(rt.capDrawnKj / def.draw.capFedEnergyPerShotKj, 1);
      }
      const tempC = snap ? c.hottestCellC(p.instanceId, snap) : 25;
      let gate: WeaponFrame['gate'] = null;
      if (!destroyed) {
        const despawnRange = def.weapon!.falloff.max * WEAPON_REACH_MULT
          * c.weaponRangeMultiplier(p.instanceId)
          * (myTile === 'hill' ? HILL_RANGE_MULT : 1);
        const halfArc = (c.weaponArcDeg(p.instanceId, def.weapon!.mountArcDeg) / 2) * (Math.PI / 180);
        // Same order and the same unscaling the autopilot uses, so the readout
        // names the gate the sim actually applied.
        const rangeMultiplier = c.weaponRangeMultiplier(p.instanceId)
          * (myTile === 'hill' ? HILL_RANGE_MULT : 1);
        if (rangeToEnemy > despawnRange) gate = 'range';
        else if (bearingOffset > halfArc) gate = 'arc';
        else if (falloffAt(def, rangeToEnemy / rangeMultiplier) <= 0) gate = 'minrange';
        else if (tempC >= HEAT_FIRE_HOLD_C) gate = 'heat';
      }
      weapons.push({
        instanceId: p.instanceId,
        partId: p.partId,
        readyFrac,
        enabled: c.weaponsEnabled[p.instanceId] === true,
        status: destroyed ? 'destroyed' : rt.isShutdown ? 'shutdown' : rt.isShed ? 'shed' : 'ok',
        tempC,
        gate,
      });
    }
    let hottest = 25;
    if (snap) for (const t of Object.values(snap.cellTempsC)) if (t > hottest) hottest = t;
    const capacitorKj = snap ? Object.values(snap.capacitorStoredKj).reduce((s, kj) => s + kj, 0) : 0;
    return {
      x: c.pos.x, y: c.pos.y, facingRad: c.facingRad, speedSetting: c.speedSetting,
      coreHp: c.coreHp, functionalMassFrac: c.functionalMassFrac(),
      weapons,
      hottestCellC: hottest,
      capacitorKj,
      supplyKw: snap?.totalSupplyKw ?? 0,
      demandKw: snap?.totalDemandKw ?? 0,
      moveIntent: c.moveIntent,
      faceMode: c.faceOrder.mode,
      dest: c.destination ? { x: c.destination.x, y: c.destination.y } : null,
      tile: terrainAt(this.terrain, c.pos.x, c.pos.y),
    };
  }

  /**
   * Applies orders to a mech and logs each verb whose meaning changed since
   * the last logged order (destination coordinates are tracking noise; intent,
   * throttle, facing mode, and the enabled-weapon set are decisions).
   */
  issueOrders(mech: 0 | 1, orders: MechOrder[]): void {
    for (const order of orders) {
      applyOrder(this.combatants[mech], order, this.tSec);
      const sig = order.verb === 'weapons'
        ? Object.keys(order.enabled).filter((id) => order.enabled[id]).sort().join(',')
        : order.verb === 'move' ? order.intent
        : order.verb === 'throttle' ? order.setting
        // Half-radian buckets: a continuously tracked bearing (face-movement
        // mode) is steering noise, not a new decision.
        : order.mode === 'bearing' ? `bearing:${(Math.round(order.bearingRad * 2) / 2).toFixed(1)}` : 'target';
      if (this.lastOrderSig[mech][order.verb] !== sig) {
        this.lastOrderSig[mech][order.verb] = sig;
        this.events.push({ tSec: this.tSec, type: 'order', mech, order });
      }
    }
  }

  /**
   * Hard body collision: no order the autopilot or a player can issue closes
   * range past both mechs' hulls. Nothing upstream priced this — the exchange
   * scan starts at 10 m and a slant/overshoot can still walk two mechs through
   * that floor from opposite sides in one tick — so it is enforced here, once,
   * on the resolved positions rather than threaded through every mover.
   */
  private resolveBodyCollision(): void {
    const [a, b] = this.combatants;
    const minSepM = meanSilhouetteHalfWidthM(a.chassis) + meanSilhouetteHalfWidthM(b.chassis);
    const delta = sub(b.pos, a.pos);
    const dist = len(delta);
    if (dist >= minSepM || dist < 1e-6) return;
    const push = norm(delta);
    const overlap = minSepM - dist;
    a.pos = sub(a.pos, scale(push, overlap / 2));
    b.pos = add(b.pos, scale(push, overlap / 2));
    // Kill the closing component so the pair settles at arm's length instead
    // of being shoved apart and immediately driven back together next tick.
    const relVel = sub(b.vel, a.vel);
    const closingSpeed = -(relVel.x * push.x + relVel.y * push.y);
    if (closingSpeed > 0) {
      a.vel = sub(a.vel, scale(push, closingSpeed / 2));
      b.vel = add(b.vel, scale(push, closingSpeed / 2));
    }
  }

  private logTransitions(i: 0 | 1, snapshot: SimSnapshot): void {
    const shed = new Set(snapshot.shedInstanceIds);
    for (const id of shed) {
      if (!this.lastShed[i].has(id)) this.events.push({ tSec: this.tSec, type: 'shed', mech: i, instanceId: id });
    }
    this.lastShed[i] = shed;
    const shut = new Set(snapshot.shutdownInstanceIds);
    for (const id of shut) {
      if (!this.lastShutdown[i].has(id)) this.events.push({ tSec: this.tSec, type: 'shutdown', mech: i, instanceId: id });
    }
    this.lastShutdown[i] = shut;
  }

  private resolveShot(i: 0 | 1, self: Combatant, enemy: Combatant, instanceId: string, partId: string): void {
    const def = getPart(partId);
    const weapon = def.weapon!;
    const salvo = weapon.salvoCount ?? 1;
    const toEnemy = sub(enemy.pos, self.pos);
    const range = len(toEnemy);
    const aimBearing = datan2(toEnemy.y, toEnemy.x);
    const losDir = norm(toEnemy);
    const fireControlMult = self.fireControlLateralMult(this.lastSnapshots[i]);
    const lagS = TRACKING_LAG_S;
    // Terrain (docs/03 §2): a shooter on a hill fires down an extended
    // envelope; a target in forest shows a reduced silhouette.
    const shooterTile = terrainAt(this.terrain, self.pos.x, self.pos.y);
    const targetTile = terrainAt(this.terrain, enemy.pos.x, enemy.pos.y);
    const rangeMult = self.weaponRangeMultiplier(instanceId)
      * (shooterTile === 'hill' ? HILL_RANGE_MULT : 1);
    // Modifiers (docs/04 §4b): shooter's weapon mults + defender's profile.
    const shooterM = self.partMults(instanceId, shooterTile);
    const halfWidthM = enemy.projectedHalfWidthM(losDir)
      * (targetTile === 'forest' ? FOREST_COVER_MULT : 1)
      * enemy.profileMult(targetTile);
    const model = computeHitModel({
      rangeM: range,
      sigmaRad: this.effectiveDispersionRad(self, instanceId, def, aimBearing, shooterTile, shooterM),
      lateralSpeedMps: enemy.lateralSpeedMps(losDir),
      lagS,
      lateralPenaltyMult: fireControlMult * shooterM.lateralPenalty,
      projectileSpeed: weapon.projectileSpeed,
      targetHalfWidthM: halfWidthM,
    });
    const damagePerProjectile = weapon.damage * shooterM.damage * falloffAt(def, range / rangeMult);

    const stats = this.stats[i]!;
    for (let s = 0; s < salvo; s++) {
      stats.shotsFired++;
      const hitRoll = this.rng.nextFloat() < model.pHit;
      let result: ShotResolution = { hit: false, damaged: [] };
      if (hitRoll) {
        // Accuracy answers "did the mech get hit?" Locational resolution then
        // samples the exposed equipment/chassis pool uniformly; zero spread
        // therefore does not bore repeatedly through the centerline.
        result = enemy.applySpatialHit(losDir, damagePerProjectile, this.rng.nextFloat());
      }
      const dealt = result.damaged.reduce((sum, d) => sum + d.damage, 0);
      if (result.hit) {
        stats.shotsHit++;
        stats.damageDealt += dealt;
        for (const d of result.damaged) {
          if (d.instanceId !== CORE_INSTANCE_ID && d.instanceId !== CHASSIS_INSTANCE_ID && !enemy.isPartFunctional(d.instanceId) && (enemy.hpByInstance.get(d.instanceId) ?? 1) <= 0) {
            // Only log the destruction once (the hit resolver already marked it in the sim).
            if (!this.events.some((e) => e.type === 'part-destroyed' && e.mech !== i && e.instanceId === d.instanceId)) {
              this.events.push({ tSec: this.tSec, type: 'part-destroyed', mech: (1 - i) as 0 | 1, instanceId: d.instanceId, partId: d.partId, cause: 'damage' });
            }
          }
        }
        if (dealt / enemy.massT >= STAGGER_DAMAGE_PER_T) {
          enemy.staggerUntilS = this.tSec + 0.3;
          enemy.staggerDispersionUntilS = this.tSec + 1.0;
        }
        // System-attacking effects (docs/07 Track C §4): a flamer cooks the
        // struck cell; an ion cannon bleeds the enemy's stored charge. Both
        // land in addition to the HP damage above and modify already-hashed
        // sim state, so they stay lockstep-deterministic.
        if (weapon.enemyHeatKj && result.entryCell) {
          enemy.sim.depositHeatAtCell(`${result.entryCell.x},${result.entryCell.y}`, weapon.enemyHeatKj);
        }
        if (weapon.capDrainKj) enemy.sim.drainCapacitorChargeKj(weapon.capDrainKj);
      }
      this.events.push({
        tSec: this.tSec, type: 'shot', mech: i, instanceId, partId,
        hit: result.hit, totalDamageDealt: dealt, entryCell: result.entryCell,
        damaged: result.damaged.length > 0 ? result.damaged : undefined,
      });
    }

    // Recoil shoves the shooter opposite the aim bearing (docs/03 §3).
    if (weapon.recoilKnS) {
      const dvMps = weapon.recoilKnS / self.massT;
      self.vel = add(self.vel, scale({ x: dcos(aimBearing), y: dsin(aimBearing) }, -dvMps));
    }
  }

  /** Base dispersion + motion jitter, then turning x arc-edge x stagger multipliers (docs/03 §5). */
  private effectiveDispersionRad(self: Combatant, instanceId: string, def: PartDef, aimBearing: number, tile: TerrainType, m: Readonly<EffectiveMults> = NEUTRAL_MULTS): number {
    let mrad = weaponSigmaMrad({
      dispersionMrad: def.weapon!.dispersionMrad,
      speedMps: len(self.vel),
      mults: m,
      chassisMoveJitterMult: (self.chassis.moveJitterMult ?? 1) * self.mechMoveJitterMult(tile),
    });
    // Neutral turnJitter (1) reproduces the flat ×1.3 spike exactly; a source
    // that scales it down only buys back the 0.3 of excess above ×1, so it
    // can shrink the spike but never invert it into a bonus.
    if (Math.abs(self.lastTurnRateRadS) > 45 * (Math.PI / 180)) mrad *= 1 + 0.3 * self.turnJitterMult(tile);
    const halfArc = (self.weaponArcDeg(instanceId, def.weapon!.mountArcDeg) / 2) * (Math.PI / 180);
    const offset = Math.abs(wrapAngle(aimBearing - self.facingRad));
    if (halfArc > 0 && offset > 0.75 * halfArc) mrad *= 1.25;
    if (this.tSec < self.staggerDispersionUntilS) mrad *= 1.5;
    return mrad * 0.001;
  }

  private checkVictory(): void {
    const [a, b] = this.combatants;

    const chassisDead = [a.coreHp <= 0, b.coreHp <= 0];
    if (chassisDead[0] || chassisDead[1]) {
      const winner = chassisDead[0] && chassisDead[1] ? 'draw' : chassisDead[0] ? 1 : 0;
      this.declare(winner, 'chassis-failure');
      return;
    }

    // Mission-kill: no functional weapons -> surrender 3 s later (docs/03 §1).
    for (const i of this.suppressSurrender ? [] : ([0, 1] as const)) {
      const self = this.combatants[i];
      if (!self.hasFunctionalWeapons()) {
        if (this.surrenderTimers[i] === null) {
          this.surrenderTimers[i] = this.tSec;
          this.events.push({ tSec: this.tSec, type: 'surrender-countdown', mech: i });
        } else if (this.tSec - this.surrenderTimers[i]! >= SURRENDER_DELAY_S) {
          this.declare((1 - i) as 0 | 1, 'mission-kill');
          return;
        }
      } else {
        this.surrenderTimers[i] = null;
      }
    }

    if (this.tSec >= this.timeoutS) {
      const fa = a.functionalMassFrac();
      const fb = b.functionalMassFrac();
      this.declare(Math.abs(fa - fb) < 1e-9 ? 'draw' : fa > fb ? 0 : 1, 'judges');
    }
  }

  /**
   * FNV-1a over the exact float bits of all mutable battle state (docs/11
   * M1): the lockstep desync detector. Two sims that agree here are in the
   * same world; iteration orders are deterministic (parts arrays, Map
   * insertion order from construction).
   */
  stateHash(): number {
    const view = new DataView(new ArrayBuffer(8));
    let h = 0x811c9dc5;
    const mixByte = (b: number) => { h ^= b; h = Math.imul(h, 0x01000193); };
    const f = (v: number) => {
      view.setFloat64(0, v, true);
      for (let i = 0; i < 8; i++) mixByte(view.getUint8(i));
    };
    const u = (v: number) => {
      view.setUint32(0, v >>> 0, true);
      for (let i = 0; i < 4; i++) mixByte(view.getUint8(i));
    };

    f(this.tSec);
    u(this.tick);
    for (const c of this.combatants) {
      f(c.pos.x); f(c.pos.y); f(c.vel.x); f(c.vel.y);
      f(c.facingRad); f(c.coreHp); f(c.lastTurnRateRadS);
      for (const p of c.build.parts) f(c.hpByInstance.get(p.instanceId) ?? 0);
      for (const cell of c.sim.thermal.cells.values()) f(cell.tempC);
      for (const kj of c.sim.capacitorLevels()) f(kj);
    }
    const [hi, lo] = this.rng.stateBits();
    u(hi); u(lo);
    const [flag, spare] = this.rng.spareState();
    u(flag); f(spare);
    return h >>> 0;
  }

  private declare(winner: 0 | 1 | 'draw', reason: VictoryReason): void {
    this.outcome = { winner, reason };
    this.events.push({ tSec: this.tSec, type: 'victory', winner, reason });
  }

  report(): BattleReport {
    if (!this.outcome) throw new Error('Battle not finished');
    const mechs = [0, 1].map((i) => {
      const self = this.combatants[i]!;
      const partsLost = self.build.parts
        .filter((p) => !self.isPartFunctional(p.instanceId))
        .map((p) => ({ instanceId: p.instanceId, partId: p.partId }));
      return {
        chassisId: self.build.chassisId,
        capacitorMaxKj: buildCapacitorMaxKj(self.build),
        ...this.stats[i]!,
        partsLost,
        partsFinalHp: self.build.parts.map((p) => ({
          instanceId: p.instanceId,
          partId: p.partId,
          hpFrac: self.partHpFrac(p.instanceId, p.partId),
        })),
        functionalMassFrac: self.functionalMassFrac(),
        coreHpRemaining: self.coreHp,
        chassisIntegrityRemaining: self.coreHp,
        chassisIntegrityMax: self.chassis.maxIntegrity,
        chassisIntegrityFrac: self.coreHp / self.chassis.maxIntegrity,
      };
    }) as [MechReport, MechReport];
    return {
      seed: this.seed,
      durationS: this.tSec,
      winner: this.outcome.winner,
      reason: this.outcome.reason,
      mechs,
      events: this.events,
      arena: this.arena,
      terrain: this.terrain,
      frames: this.frames,
    };
  }
}

/** Runs a battle to completion and returns the report. */
export function runBattle(options: BattleOptions): BattleReport {
  const battle = new Battle(options);
  const maxTicks = Math.ceil(((options.timeoutS ?? DEFAULT_TIMEOUT_S) + 5) / TICK_S);
  for (let i = 0; i < maxTicks && battle.step(); i++) { /* tick */ }
  if (!battle.finished) throw new Error('Battle failed to terminate (timeout check did not fire)');
  return battle.report();
}
