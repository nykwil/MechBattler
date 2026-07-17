/**
 * The combat arena: two builds fight under autopilot on a flat 2D plane.
 * See docs/03-combat-spec.md. Headless and rendering-free (rule R6) -- a
 * renderer is a playback layer over the tick states / battle report.
 *
 * Shot resolution (decided Jul 2026, see docs/03 §5 note): every shot's real
 * bearing is sampled (aim bearing + seeded gaussian dispersion) and resolved
 * as an instant ray against the target's oriented grid footprint. Real
 * geometry, real entry cells; no travel time yet. Projectile flight time +
 * dead reckoning layer on later without changing this interface.
 *
 * Simplifications this pass (extend, don't silently inherit):
 *  - Mount arcs are always centered on chassis forward (side/rear mounts and
 *    location affinity are not implemented; docs/07 gap list).
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
import { Simulation, type SimCommand, type SimSnapshot, type SpeedSetting } from './simulation.js';
import { computeIdealRangeBand, falloffAt, type IdealRangeBand } from './derivedStats.js';
import { CORE_INSTANCE_ID } from './thermal.js';
import { Pcg32 } from './rng.js';

export const CELL_SIZE_M = 0.5;
export const TICK_S = 1 / 20;
export const AUTOPILOT_PERIOD_TICKS = 5; // 4 Hz (docs/03 §7)
export const DEFAULT_TIMEOUT_S = 120;
export const DEFAULT_SPAWN_DISTANCE_M = 160;
/** Arena rectangle (docs/03 §1): 200 m × 140 m. Walls bound movement -- a
 *  kiter has only (arenaLength − spawnDistance)/2 of runway before its back
 *  wall, so infinite runaway is impossible. This is the counter to the
 *  runaway-sniper degeneracy: at some point the sniper must stand and fight. */
export const DEFAULT_ARENA_LENGTH_M = 200;
export const DEFAULT_ARENA_WIDTH_M = 140;
/** The core is not a catalog part; its HP needs prototype validation (add to docs/03 §10). */
export const CORE_HP = 50;
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
 * makes speed a defensive stat even for steady movement. A powered U-TC1
 * targeting computer shortens the lag.
 */
export const TRACKING_LAG_BASE_S = 0.3;
export const TRACKING_LAG_TC_S = 0.1;

const SPEED_DISPERSION_MULT: Record<SpeedSetting, number> = {
  stationary: 0.7, // treated as creep-or-better (docs/03 §4 has no stationary row; standing still is at least as steady)
  creep: 0.7,
  cruise: 1.0,
  flank: 1.6,
};

export interface Vec2 { x: number; y: number }

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : { x: 1, y: 0 }; };

/** Abramowitz-Stegun 7.1.26 erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}

export interface HitModelInputs {
  rangeM: number;
  /** Weapon dispersion after all shooter-state multipliers, in radians. */
  sigmaRad: number;
  /** Target speed perpendicular to the line of sight, m/s. */
  lateralSpeedMps: number;
  /** Fire-control latency (TRACKING_LAG_BASE_S, or _TC_S with a powered U-TC1). */
  lagS: number;
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
export function computeHitModel(inputs: HitModelInputs): HitModel {
  const tofS = inputs.projectileSpeed === 'hitscan' ? 0 : inputs.rangeM / Math.max(inputs.projectileSpeed, 1);
  const aimStalenessS = inputs.lagS + tofS;
  const dispersionM = inputs.sigmaRad * inputs.rangeM;
  const leadErrorM = inputs.lateralSpeedMps * aimStalenessS;
  const sigmaM = Math.hypot(dispersionM, leadErrorM);
  const pHit = sigmaM < 1e-9 ? 1 : erf(inputs.targetHalfWidthM / (sigmaM * Math.SQRT2));
  return { pHit, sigmaM, aimStalenessS };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// --- Battle events / report -------------------------------------------------

export interface ShotResolution {
  hit: boolean;
  /** Instance ids damaged along the penetration path, in order, with damage dealt. '__core__' for the core. */
  damaged: { instanceId: string; partId: string; damage: number }[];
  entryCell?: { x: number; y: number };
}

export type BattleEvent =
  | { tSec: number; type: 'shot'; mech: 0 | 1; instanceId: string; partId: string; hit: boolean; totalDamageDealt: number; entryCell?: { x: number; y: number }; damaged?: { instanceId: string; partId: string; damage: number }[] }
  | { tSec: number; type: 'part-destroyed'; mech: 0 | 1; instanceId: string; partId: string; cause: 'damage' | 'heat' | 'cookoff' }
  | { tSec: number; type: 'shed'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'shutdown'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'cookoff'; mech: 0 | 1; instanceId: string }
  | { tSec: number; type: 'surrender-countdown'; mech: 0 | 1 }
  | { tSec: number; type: 'victory'; winner: 0 | 1 | 'draw'; reason: VictoryReason };

export type VictoryReason = 'core-kill' | 'mission-kill' | 'judges';

export interface MechReport {
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  partsLost: { instanceId: string; partId: string }[];
  /** Functional part mass remaining / total part mass, for judges' decisions (docs/03 §1). */
  functionalMassFrac: number;
  coreHpRemaining: number;
}

export interface BattleReport {
  seed: number;
  durationS: number;
  winner: 0 | 1 | 'draw';
  reason: VictoryReason;
  mechs: [MechReport, MechReport];
  events: BattleEvent[];
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
  weaponsEnabled: Record<string, boolean> = {};
  staggerUntilS = -1;
  staggerDispersionUntilS = -1;
  /** Orbit direction for strafe-capable chassis (docs/03 §7 verb 3). Constant for now. */
  orbitDir: 1 | -1 = 1;
  /** Actual turn rate last tick, for the >45 deg/s dispersion penalty (docs/03 §5). */
  lastTurnRateRadS = 0;

  coreHp = CORE_HP;
  hpByInstance = new Map<string, number>();
  private heatDamageSeen = new Map<string, number>();
  private occupancy: ReturnType<typeof buildOccupancyMap>;

  constructor(build: Build, pos: Vec2, facingRad: number) {
    this.build = build;
    this.chassis = getChassis(build.chassisId);
    this.sim = new Simulation(this.chassis, build);
    this.band = computeIdealRangeBand(build);
    this.speeds = computeLoadScaledSpeeds(this.chassis, computeMassAndCoG(this.chassis, build.parts));
    this.pos = pos;
    this.facingRad = facingRad;
    this.occupancy = buildOccupancyMap(build.parts);
    let partMass = 0;
    for (const p of build.parts) {
      const def = getPart(p.partId);
      this.hpByInstance.set(p.instanceId, def.hp * p.integrity);
      this.heatDamageSeen.set(p.instanceId, 0);
      partMass += def.massKg;
    }
    this.totalPartMassKg = partMass;
  }

  get massT(): number { return this.sim.massT; }

  forward(): Vec2 { return { x: Math.cos(this.facingRad), y: Math.sin(this.facingRad) }; }
  right(): Vec2 { return { x: Math.sin(this.facingRad), y: -Math.cos(this.facingRad) }; }

  isPartFunctional(instanceId: string): boolean {
    return !this.sim.isDestroyed(instanceId);
  }

  /** True if a functional U-TC1 is currently powered (not shed, not shut down). */
  hasPoweredTargetingComputer(snapshot: SimSnapshot | null): boolean {
    return this.build.parts.some((p) =>
      p.partId === 'U-TC1' &&
      this.isPartFunctional(p.instanceId) &&
      (snapshot === null ||
        (!snapshot.shedInstanceIds.includes(p.instanceId) && !snapshot.shutdownInstanceIds.includes(p.instanceId))),
    );
  }

  hasFunctionalWeapons(): boolean {
    return this.build.parts.some(
      (p) => getPart(p.partId).category === 'weapon' && this.isPartFunctional(p.instanceId),
    );
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

  /**
   * Resolves a world-space ray (a shot that intersected this mech) into
   * locational damage per docs/01 §5 and docs/03 §6: entry cell on the struck
   * perimeter, occupant takes the damage, overkill penetrates inward along
   * the travel line at 50%, wreck cells absorb 25%, empty mask holes pass
   * damage through untouched.
   */
  applyRay(originWorld: Vec2, dirWorld: Vec2, damage: number): ShotResolution {
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
    const stepLen = Math.hypot(stepX, stepY);
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
        remaining = this.coreHp <= 0 ? (remaining - dealt) * 0.5 : 0;
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
        remaining = (remaining - dealt) * 0.5; // overkill penetrates (docs/01 §5)
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

/**
 * The four-verb autopilot (docs/03 §7), evaluated at 4 Hz. Writes destination,
 * speed setting, facing intent, and per-weapon enables onto the combatant.
 */
function runAutopilot(self: Combatant, enemy: Combatant, snapshot: SimSnapshot | null): void {
  const toEnemy = sub(enemy.pos, self.pos);
  const range = len(toEnemy);
  const dir = norm(toEnemy);
  const band = self.band;
  const bandCenter = (band.bandStart + band.bandEnd) / 2;

  // Verb 2: destination.
  const canOrbit = self.chassis.speedsMps.strafe >= 0.75 * self.chassis.speedsMps.fwd;
  if (band.bandEnd <= 0) {
    self.destination = null; // no weapons: hold (nothing better to do yet)
  } else if (range > band.bandEnd || range < band.bandStart) {
    // Seek the band center along the line to the enemy (close in or back away).
    self.destination = sub(enemy.pos, scale(dir, bandCenter));
  } else if (canOrbit) {
    // Spiders orbit while facing (docs/03 §7): aim for a point at band-center
    // range, rotated ahead along the orbit — sustained lateral motion that
    // exercises the enemy's tracking lag.
    const stepRad = 0.35 * self.orbitDir;
    const cosR = Math.cos(stepRad);
    const sinR = Math.sin(stepRad);
    const fromEnemy = scale(dir, -bandCenter);
    self.destination = add(enemy.pos, {
      x: fromEnemy.x * cosR - fromEnemy.y * sinR,
      y: fromEnemy.x * sinR + fromEnemy.y * cosR,
    });
  } else {
    // Inside the band: drift toward band center distance.
    self.destination = Math.abs(range - bandCenter) > 5 ? sub(enemy.pos, scale(dir, bandCenter)) : null;
  }

  // Verb 3: speed setting.
  const inBand = range >= band.bandStart && range <= band.bandEnd;
  let precisionActive = false;

  // Verb 1: weapons on/off (arc + range + temperature; brownout preview not yet implemented).
  const bearingToEnemy = Math.atan2(dir.y, dir.x);
  const bearingOffset = Math.abs(wrapAngle(bearingToEnemy - self.facingRad));
  for (const p of self.build.parts) {
    const def = getPart(p.partId);
    if (def.category !== 'weapon') continue;
    if (!self.isPartFunctional(p.instanceId)) { self.weaponsEnabled[p.instanceId] = false; continue; }
    const halfArc = (def.weapon!.mountArcDeg / 2) * (Math.PI / 180);
    const inArc = bearingOffset <= halfArc;
    const despawnRange = def.weapon!.falloff.rangeEnd * 1.3;
    const coolEnough = snapshot === null || self.hottestCellC(p.instanceId, snapshot) < 115;
    const enabled = inArc && range <= despawnRange && coolEnough;
    self.weaponsEnabled[p.instanceId] = enabled;
    if (enabled && def.weapon!.dispersionMrad <= 2) precisionActive = true;
  }

  if (range > 1.5 * band.bandEnd) self.speedSetting = 'flank';
  else if (inBand && precisionActive) self.speedSetting = 'creep';
  else self.speedSetting = 'cruise';
  if (self.destination === null) self.speedSetting = 'stationary';
}

// --- Movement integration ------------------------------------------------------

/** Max achievable speed moving at `angleOffRad` from facing: an ellipse through fwd/rev and strafe maxima. */
function maxSpeedInDirection(speeds: LoadScaledSpeeds, angleOffRad: number): number {
  const c = Math.cos(angleOffRad);
  const s = Math.sin(angleOffRad);
  const axial = c >= 0 ? speeds.fwd : speeds.rev;
  const denom = Math.sqrt((c / Math.max(axial, 0.01)) ** 2 + (s / Math.max(speeds.strafe, 0.01)) ** 2);
  return denom > 1e-9 ? 1 / denom : 0;
}

const SPEED_FRACTION: Record<SpeedSetting, number> = { stationary: 0, creep: 0.3, cruise: 0.65, flank: 1.0 };

function integrateMovement(self: Combatant, enemy: Combatant, locomotionShed: boolean, tSec: number, dt: number): void {
  // Verb 4: facing = face target (v0 autopilot default).
  const desired = Math.atan2(enemy.pos.y - self.pos.y, enemy.pos.x - self.pos.x);
  const before = self.facingRad;
  if (tSec >= self.staggerUntilS) {
    const maxTurn = self.speeds.turnRateDegS * (Math.PI / 180) * dt;
    const delta = wrapAngle(desired - self.facingRad);
    self.facingRad = wrapAngle(self.facingRad + Math.max(-maxTurn, Math.min(maxTurn, delta)));
  }
  self.lastTurnRateRadS = wrapAngle(self.facingRad - before) / dt;

  const accel = self.chassis.accelMps2 * self.speeds.loadFactor;
  let targetVel: Vec2 = { x: 0, y: 0 };
  if (self.destination && !locomotionShed) {
    const toDest = sub(self.destination, self.pos);
    const dist = len(toDest);
    if (dist > 0.5) {
      const dir = norm(toDest);
      const angleOff = wrapAngle(Math.atan2(dir.y, dir.x) - self.facingRad);
      const maxV = maxSpeedInDirection(self.speeds, angleOff) * SPEED_FRACTION[self.speedSetting];
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

export interface BattleOptions {
  builds: [Build, Build];
  seed: number;
  timeoutS?: number;
  spawnDistanceM?: number;
  arenaLengthM?: number;
  arenaWidthM?: number;
}

export class Battle {
  readonly combatants: [Combatant, Combatant];
  readonly events: BattleEvent[] = [];
  readonly seed: number;
  private readonly rng: Pcg32;
  private readonly timeoutS: number;
  private readonly arenaHalfLengthM: number;
  private readonly arenaHalfWidthM: number;
  private tSec = 0;
  private tick = 0;
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
    this.arenaHalfLengthM = (options.arenaLengthM ?? DEFAULT_ARENA_LENGTH_M) / 2;
    this.arenaHalfWidthM = (options.arenaWidthM ?? DEFAULT_ARENA_WIDTH_M) / 2;
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
      new Combatant(options.builds[0], posA, Math.atan2(posB.y - posA.y, posB.x - posA.x)),
      new Combatant(options.builds[1], posB, Math.atan2(posA.y - posB.y, posA.x - posB.x)),
    ];
  }

  get finished(): boolean { return this.outcome !== null; }

  /** Runs one 50 ms tick. Returns false once the battle has been decided. */
  step(): boolean {
    if (this.outcome) return false;
    const dt = TICK_S;
    this.tSec += dt;
    const [a, b] = this.combatants;

    // Autopilot at 4 Hz.
    if (this.tick % AUTOPILOT_PERIOD_TICKS === 0) {
      runAutopilot(a, b, this.lastSnapshots[0]);
      runAutopilot(b, a, this.lastSnapshots[1]);
    }
    this.tick++;

    // Power/heat/weapon-cycle sim per mech, then resolve any shots it produced.
    for (const i of [0, 1] as const) {
      const self = this.combatants[i];
      const enemy = this.combatants[1 - i];
      const command: SimCommand = { weaponsEnabled: self.weaponsEnabled, speedSetting: self.speedSetting };
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
        const per = neighbors.size > 0 ? 40 / neighbors.size : 0;
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
      const locomotionShed = this.lastSnapshots[i]?.shedInstanceIds.includes(CORE_INSTANCE_ID) ?? false;
      const c = this.combatants[i];
      integrateMovement(c, this.combatants[1 - i], locomotionShed, this.tSec, dt);
      if (c.pos.x < -this.arenaHalfLengthM) { c.pos.x = -this.arenaHalfLengthM; c.vel.x = Math.max(0, c.vel.x); }
      else if (c.pos.x > this.arenaHalfLengthM) { c.pos.x = this.arenaHalfLengthM; c.vel.x = Math.min(0, c.vel.x); }
      if (c.pos.y < -this.arenaHalfWidthM) { c.pos.y = -this.arenaHalfWidthM; c.vel.y = Math.max(0, c.vel.y); }
      else if (c.pos.y > this.arenaHalfWidthM) { c.pos.y = this.arenaHalfWidthM; c.vel.y = Math.min(0, c.vel.y); }
    }

    this.checkVictory();
    return this.outcome === null;
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
    const aimBearing = Math.atan2(toEnemy.y, toEnemy.x);
    const losDir = norm(toEnemy);
    const lagS = self.hasPoweredTargetingComputer(this.lastSnapshots[i]) ? TRACKING_LAG_TC_S : TRACKING_LAG_BASE_S;
    const halfWidthM = enemy.projectedHalfWidthM(losDir);
    const model = computeHitModel({
      rangeM: range,
      sigmaRad: this.effectiveDispersionRad(self, def, aimBearing),
      lateralSpeedMps: enemy.lateralSpeedMps(losDir),
      lagS,
      projectileSpeed: weapon.projectileSpeed,
      targetHalfWidthM: halfWidthM,
    });
    const damagePerProjectile = weapon.damage * falloffAt(def, range);

    for (let s = 0; s < salvo; s++) {
      this.stats[i].shotsFired++;
      const hitRoll = this.rng.nextFloat() < model.pHit;
      let result: ShotResolution = { hit: false, damaged: [] };
      if (hitRoll) {
        // The shot lands: sample where across the silhouette (truncated
        // gaussian), then run the ray for entry cell + penetration.
        let offsetM = 0;
        for (let tries = 0; tries < 8; tries++) {
          offsetM = this.rng.gaussian() * model.sigmaM;
          if (Math.abs(offsetM) <= halfWidthM) break;
          if (tries === 7) offsetM = (this.rng.nextFloat() * 2 - 1) * halfWidthM;
        }
        const perp: Vec2 = { x: -losDir.y, y: losDir.x };
        const impact = add(enemy.pos, scale(perp, offsetM));
        result = enemy.applyRay(self.pos, norm(sub(impact, self.pos)), damagePerProjectile);
      }
      const dealt = result.damaged.reduce((sum, d) => sum + d.damage, 0);
      if (result.hit) {
        this.stats[i].shotsHit++;
        this.stats[i].damageDealt += dealt;
        for (const d of result.damaged) {
          if (d.instanceId !== CORE_INSTANCE_ID && !enemy.isPartFunctional(d.instanceId) && (enemy.hpByInstance.get(d.instanceId) ?? 1) <= 0) {
            // Only log the destruction once (applyRay already marked it in the sim).
            if (!this.events.some((e) => e.type === 'part-destroyed' && e.mech !== i && e.instanceId === d.instanceId)) {
              this.events.push({ tSec: this.tSec, type: 'part-destroyed', mech: (1 - i) as 0 | 1, instanceId: d.instanceId, partId: d.partId, cause: 'damage' });
            }
          }
        }
        if (dealt / enemy.massT >= STAGGER_DAMAGE_PER_T) {
          enemy.staggerUntilS = this.tSec + 0.3;
          enemy.staggerDispersionUntilS = this.tSec + 1.0;
        }
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
      self.vel = add(self.vel, scale({ x: Math.cos(aimBearing), y: Math.sin(aimBearing) }, -dvMps));
    }
  }

  /** Base dispersion x speed-setting x turning x arc-edge x stagger multipliers (docs/03 §5). */
  private effectiveDispersionRad(self: Combatant, def: PartDef, aimBearing: number): number {
    let mrad = def.weapon!.dispersionMrad * SPEED_DISPERSION_MULT[self.speedSetting];
    if (Math.abs(self.lastTurnRateRadS) > 45 * (Math.PI / 180)) mrad *= 1.3;
    const halfArc = (def.weapon!.mountArcDeg / 2) * (Math.PI / 180);
    const offset = Math.abs(wrapAngle(aimBearing - self.facingRad));
    if (halfArc > 0 && offset > 0.75 * halfArc) mrad *= 1.25;
    if (this.tSec < self.staggerDispersionUntilS) mrad *= 1.5;
    return mrad * 0.001;
  }

  private checkVictory(): void {
    const [a, b] = this.combatants;

    const coreDead = [a.coreHp <= 0, b.coreHp <= 0];
    if (coreDead[0] || coreDead[1]) {
      const winner = coreDead[0] && coreDead[1] ? 'draw' : coreDead[0] ? 1 : 0;
      this.declare(winner, 'core-kill');
      return;
    }

    // Mission-kill: no functional weapons -> surrender 3 s later (docs/03 §1).
    for (const i of [0, 1] as const) {
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
        ...this.stats[i]!,
        partsLost,
        functionalMassFrac: self.functionalMassFrac(),
        coreHpRemaining: self.coreHp,
      };
    }) as [MechReport, MechReport];
    return {
      seed: this.seed,
      durationS: this.tSec,
      winner: this.outcome.winner,
      reason: this.outcome.reason,
      mechs,
      events: this.events,
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
