/**
 * Workshop derived stats (docs/02-power-heat-spec.md §6, docs/03-combat-spec.md §3/§7).
 *
 * Two tiers, both grounded in the real model (rule R5 -- no guessed numbers):
 *  - Stats with no time-dependence (speed profile, energy margin, burst DPS,
 *    weapon envelopes/ideal range band) are exact closed-form results of the
 *    same formulas the simulation uses -- there is nothing to "simulate,"
 *    a stepped run would just reproduce the same arithmetic slower.
 *  - Stats that depend on heat build-up over time (sustained DPS,
 *    time-to-overheat, which parts brown out under sustained fire) have real
 *    feedback loops (thresholds, hysteresis) that closed-form can't capture
 *    faithfully, so these come from literally running the Simulation engine
 *    (the "Test Bench") and measuring the result.
 */
import type { Build, ChassisSpec, PartDef, PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { dexp } from './dmath.js';
import { computeLoadScaledSpeeds, computeMassAndCoG } from './grid.js';
import { Simulation, SPEED_SETTING_FRACTIONS, type SimCommand, type SpeedSetting } from './simulation.js';
import { RADIATOR_CAP_KW } from './thermal.js';

export interface SpeedProfile {
  massT: number;
  loadFactor: number;
  fwd: number;
  strafe: number;
  rev: number;
  turnRateDegS: number;
}

/** docs/03-combat-spec.md §3: load and CoG-offset modifiers on chassis-rated speeds. */
export function computeSpeedProfile(chassis: ChassisSpec, build: Build): SpeedProfile {
  const massAndCoG = computeMassAndCoG(chassis, build.parts);
  const scaled = computeLoadScaledSpeeds(chassis, massAndCoG);
  return { massT: massAndCoG.totalMassT, ...scaled };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function weaponInstances(build: Build): { part: PlacedPart; def: PartDef }[] {
  return build.parts
    .map((p) => ({ part: p, def: getPart(p.partId) }))
    .filter((x) => x.def.category === 'weapon');
}

/** Average continuous power draw for a weapon at max cadence, for the energy-margin estimate. */
export function averageDrawKw(def: PartDef): number {
  if (def.draw?.continuousKw) return def.draw.continuousKw;
  if (def.draw?.chargedEnergyPerShotKj) return def.draw.chargedEnergyPerShotKj / def.weapon!.cycleS;
  if (def.draw?.capFedEnergyPerShotKj) return def.draw.capFedEnergyPerShotKj / def.weapon!.cycleS;
  return 0;
}

export interface EnergyMargin {
  supplyKw: number;
  demandKw: number;
  marginKw: number;
}

/** docs/02 §6: "supply - demand with all weapons at max cadence at cruise." */
export function computeEnergyMargin(chassis: ChassisSpec, build: Build): EnergyMargin {
  const supplyKw = build.parts
    .map((p) => getPart(p.partId))
    .filter((d) => d.category === 'reactor')
    .reduce((s, d) => s + d.reactor!.outputKw, 0);

  const profile = computeSpeedProfile(chassis, build);
  const cruiseSpeed = profile.fwd * SPEED_SETTING_FRACTIONS.cruise;
  const locomotionKw = 1.2 * profile.massT * cruiseSpeed;

  const weaponsKw = weaponInstances(build).reduce((s, { def }) => s + averageDrawKw(def), 0);
  const utilityKw = build.parts
    .map((p) => getPart(p.partId))
    .filter((d) => d.category === 'utility' && d.draw?.continuousKw)
    .reduce((s, d) => s + (d.draw!.continuousKw ?? 0), 0);

  const demandKw = locomotionKw + weaponsKw + utilityKw;
  return { supplyKw, demandKw, marginKw: supplyKw - demandKw };
}

export interface HeatBalance {
  /** Heat generated with all weapons at max cadence + reactor waste at that load, kW. */
  heatInKw: number;
  /** Maximum radiator dissipation (RADIATOR_CAP_KW per radiator), kW. */
  coolingKw: number;
  marginKw: number;
  perSource: { partId: string; kw: number }[];
}

/**
 * docs/01 §9 heat balance bar: heat into the build vs. cooling capacity, at
 * "all weapons max cadence". Cooling uses the radiator hard cap (actual
 * dissipation scales with cell temperature, so this is the ceiling the build
 * approaches as it heats up — an honest capacity number for a gauge).
 */
export function computeHeatBalance(chassis: ChassisSpec, build: Build): HeatBalance {
  const perSource: { partId: string; kw: number }[] = [];
  const margin = computeEnergyMargin(chassis, build);
  const utilization = margin.supplyKw > 0 ? clamp(margin.demandKw / margin.supplyKw, 0, 1) : 0;

  let heatInKw = 0;
  let coolingKw = 0;
  for (const p of build.parts) {
    const def = getPart(p.partId);
    let kw = 0;
    if (def.weapon && def.heat?.heatPerShotKj) kw = def.heat.heatPerShotKj / def.weapon.cycleS;
    else if (def.reactor) {
      kw = Array.isArray(def.reactor.wasteHeatKw)
        ? (utilization > 0.5 ? def.reactor.wasteHeatKw[1] : def.reactor.wasteHeatKw[0])
        : def.reactor.wasteHeatKw;
    }
    if (kw > 0) { heatInKw += kw; perSource.push({ partId: def.id, kw }); }
    if (def.id === 'U-RAD') coolingKw += RADIATOR_CAP_KW;
  }
  return { heatInKw, coolingKw, marginKw: coolingKw - heatInKw, perSource };
}

export interface CapacitorBank {
  storedKj: number;
  count: number;
}

/** Total capacitor storage on the build (full-charge assumption, for time-to-empty labels). */
export function computeCapacitorBank(build: Build): CapacitorBank {
  let storedKj = 0;
  let count = 0;
  for (const p of build.parts) {
    const def = getPart(p.partId);
    if (def.capacitor) { storedKj += def.capacitor.storedKj; count++; }
  }
  return { storedKj, count };
}

/** docs/03 §7: expected-DPS-weighted envelope per weapon, folded into one ideal range band. */
export interface RangeEnvelope {
  instanceId: string;
  partId: string;
  peakDps: number;
  rangeStart: number;
  rangeEnd: number;
}

/** Damage multiplier at range r from a weapon's falloff curve (docs/03 §5). Shared with the arena. */
export function falloffAt(def: PartDef, r: number): number {
  const { rangeStart, rangeEnd, multAtEnd } = def.weapon!.falloff;
  if (r <= rangeStart) return 1.0;
  if (r >= rangeEnd) return multAtEnd;
  const t = (r - rangeStart) / (rangeEnd - rangeStart);
  return 1 - t * (1 - multAtEnd);
}

/** Rough hit probability model against a nominal 2.5m target width, from dispersion at range r. */
function hitProbabilityAt(def: PartDef, r: number): number {
  const sigmaM = def.weapon!.dispersionMrad * 0.001 * r; // dispersion cone half-width in meters at range r
  const targetHalfWidth = 1.25;
  if (sigmaM <= 0.01) return 1.0;
  // Fraction of a gaussian's mass falling within +-targetHalfWidth, approximated.
  const z = targetHalfWidth / sigmaM;
  return clamp(1 - dexp(-1.6 * z), 0.02, 1.0);
}

export function computeWeaponEnvelope(part: PlacedPart, def: PartDef): RangeEnvelope {
  const baseDps = (def.weapon!.damage * (def.weapon!.salvoCount ?? 1)) / def.weapon!.cycleS;
  const samples: { r: number; dps: number }[] = [];
  const maxR = def.weapon!.falloff.rangeEnd * 1.3;
  for (let r = 5; r <= maxR; r += 5) {
    samples.push({ r, dps: baseDps * falloffAt(def, r) * hitProbabilityAt(def, r) });
  }
  const peakDps = Math.max(...samples.map((s) => s.dps), 0.0001);
  const above = samples.filter((s) => s.dps >= 0.5 * peakDps);
  return {
    instanceId: part.instanceId,
    partId: part.partId,
    peakDps,
    rangeStart: above[0]?.r ?? 0,
    rangeEnd: above[above.length - 1]?.r ?? 0,
  };
}

export interface IdealRangeBand {
  perWeapon: RangeEnvelope[];
  bandStart: number;
  bandEnd: number;
  mismatched: boolean;
}

export function computeIdealRangeBand(build: Build): IdealRangeBand {
  const perWeapon = weaponInstances(build).map(({ part, def }) => computeWeaponEnvelope(part, def));
  if (perWeapon.length === 0) return { perWeapon, bandStart: 0, bandEnd: 0, mismatched: false };

  const totalDps = perWeapon.reduce((s, w) => s + w.peakDps, 0);
  const bandStart = perWeapon.reduce((s, w) => s + w.rangeStart * (w.peakDps / totalDps), 0);
  const bandEnd = perWeapon.reduce((s, w) => s + w.rangeEnd * (w.peakDps / totalDps), 0);

  const overlaps = perWeapon.every((a) =>
    perWeapon.some((b) => a !== b && a.rangeStart <= b.rangeEnd && a.rangeEnd >= b.rangeStart));

  return { perWeapon, bandStart, bandEnd, mismatched: !overlaps && perWeapon.length > 1 };
}

export interface BurstDps {
  totalDps: number;
  perWeapon: { instanceId: string; partId: string; dps: number }[];
}

/** First-few-seconds DPS assuming full capacitors and no heat buildup yet. */
export function computeBurstDps(build: Build): BurstDps {
  const perWeapon = weaponInstances(build).map(({ part, def }) => ({
    instanceId: part.instanceId,
    partId: part.partId,
    dps: (def.weapon!.damage * (def.weapon!.salvoCount ?? 1)) / def.weapon!.cycleS,
  }));
  return { perWeapon, totalDps: perWeapon.reduce((s, w) => s + w.dps, 0) };
}

export interface TestBenchResult {
  durationS: number;
  samples: { tSec: number; supplyKw: number; demandKw: number; maxTempC: number }[];
  shotLog: { tSec: number; instanceId: string; partId: string; totalDamage: number }[];
  cookoffLog: { tSec: number; instanceId: string }[];
  everShedInstanceIds: string[];
  everShutdownInstanceIds: string[];
  timeToOverheatS: number | null;
  sustainedDps: number;
  cellTempsFinalC: Record<string, number>;
}

export interface TestBenchOptions {
  chassis: ChassisSpec;
  build: Build;
  speedSetting?: SpeedSetting;
  durationS?: number;
  tickHz?: number;
}

/**
 * Runs the real Simulation engine (docs/02 §6: "measurements, not
 * estimates") with all weapons firing continuously, and reports the
 * time-dependent stats that closed-form math can't safely produce.
 */
export function runTestBench(options: TestBenchOptions): TestBenchResult {
  const { chassis, build } = options;
  const durationS = options.durationS ?? 60;
  const tickHz = options.tickHz ?? 20;
  const dt = 1 / tickHz;

  const sim = new Simulation(chassis, build);
  const weaponsEnabled: Record<string, boolean> = {};
  for (const p of build.parts) if (getPart(p.partId).category === 'weapon') weaponsEnabled[p.instanceId] = true;
  const command: SimCommand = { weaponsEnabled, speedSetting: options.speedSetting ?? 'cruise' };

  const samples: TestBenchResult['samples'] = [];
  const shotLog: TestBenchResult['shotLog'] = [];
  const cookoffLog: TestBenchResult['cookoffLog'] = [];
  const everShed = new Set<string>();
  const everShutdown = new Set<string>();
  let timeToOverheatS: number | null = null;
  let lastSnapshot;

  const steps = Math.round(durationS * tickHz);
  for (let i = 0; i < steps; i++) {
    const snap = sim.step(dt, command);
    lastSnapshot = snap;
    for (const id of snap.shedInstanceIds) everShed.add(id);
    for (const id of snap.shutdownInstanceIds) {
      if (!everShutdown.has(id) && timeToOverheatS === null) timeToOverheatS = snap.tSec;
      everShutdown.add(id);
    }
    for (const shot of snap.shotsThisTick) shotLog.push(shot);
    for (const c of snap.cookoffsThisTick) cookoffLog.push(c);

    if (i % Math.round(tickHz / 2) === 0) {
      const maxTempC = Math.max(...Object.values(snap.cellTempsC));
      samples.push({ tSec: snap.tSec, supplyKw: snap.totalSupplyKw, demandKw: snap.totalDemandKw, maxTempC });
    }
  }

  const lastWindowStart = Math.max(0, durationS - 10);
  const damageInWindow = shotLog.filter((s) => s.tSec >= lastWindowStart).reduce((s, x) => s + x.totalDamage, 0);
  const sustainedDps = damageInWindow / Math.min(10, durationS);

  return {
    durationS, samples, shotLog, cookoffLog,
    everShedInstanceIds: [...everShed], everShutdownInstanceIds: [...everShutdown],
    timeToOverheatS, sustainedDps,
    cellTempsFinalC: lastSnapshot?.cellTempsC ?? {},
  };
}
