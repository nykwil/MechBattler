/**
 * The tick-based power/heat/weapon simulation engine. This is the module
 * rule R6 refers to: it has no rendering dependencies and is reused by both
 * the workshop test bench and (later) the combat arena.
 *
 * Simplifications explicitly taken in this pass (all noted so a future
 * arena implementation knows what it must extend, not silently inherit):
 *  - Utilities with a continuous draw (targeting computer, servo booster)
 *    are treated as always-on when connected/powered; the four-verb combat
 *    model (docs/03 §2) only toggles weapons, not utilities.
  *  - Locomotion draw uses the load-derated straight-line forward speed
 *    (docs/03 §3 m_load formula, shared with derivedStats.ts) but is
 *    whole-on/whole-off from brownout shedding rather than continuously
 *    speed-throttled by partial power; that finer moment-to-moment
 *    integrator (plus turning, strafing, CoG-driven stagger) belongs to the
 *    arena's movement code, not the workshop power balance.
 *  - Ammo cook-off (docs/02 §3, 180C) is logged but does not yet apply its
 *    40-damage splash to neighboring cells -- splash belongs to the arena's
 *    damage model, not the stationary test bench.
 *  - Thermal conduction uses explicit Euler integration at the 20Hz tick;
 *    stable for this spec's k values but noted for future scrutiny.
 */
import type { ChassisSpec, PlacedPart, Build } from './types.js';
import { firesMechanically, getPart } from './catalog.js';
import { computeLoadScaledSpeeds, computeMassAndCoG } from './grid.js';
import { resolveSpatialPower, type SpatialPowerNetwork } from './spatialPower.js';
import {
  AMBIENT_C,
  CORE_INSTANCE_ID,
  RADIATOR_CAP_KW,
  RADIATOR_K,
  buildThermalModel,
  type ThermalModel,
} from './thermal.js';
import { EXTERIOR_PASSIVE_K, spatialCellKey } from './spatial.js';
import { INSTANCE_KNOBS, cachedOccupancy, resolveBuildEffects } from './buildEffects.js';
import { NEUTRAL_MULTS, STATIC_CTX, effectiveMults, type EffectiveMults } from './modifiers.js';
import type { TerrainType } from './terrain.js';

export type SpeedSetting = 'stationary' | 'creep' | 'cruise' | 'flank';

export const SPEED_SETTING_FRACTIONS: Record<SpeedSetting, number> = {
  stationary: 0, creep: 0.3, cruise: 0.65, flank: 1.0,
};

/**
 * The heat ladder (docs/01 §4), named so the HUD can mark it without restating it.
 * These were inline literals here and re-typed in the battle HUD, which is the one
 * thing the UI is not allowed to do: a gauge marked 130 that the sim later moved
 * would lie, silently and forever.
 */
/** Fire control holds a gun at or above this (docs/09 M2). */
export const HEAT_FIRE_HOLD_C = 115;
/** The part shuts down here, and restarts only below HEAT_RESTART_C. */
export const HEAT_SHUTDOWN_C = 130;
export const HEAT_RESTART_C = 110;
/** Above this, heat does structural damage. */
export const HEAT_DAMAGE_C = 150;
/** Arena ambient, the bottom of the HUD's heat span. */
export const HEAT_AMBIENT_C = 25;

/**
 * Ram-air cooling (docs/02 §3): airflow over the radiator scales dissipation
 * with speed. Radiator output is multiplied by (1 + RAM_AIR_MAX_BONUS × speed
 * fraction), so a flanking mech cools 50% harder than a stationary one. This
 * makes speed a cooling stat -- a fast, hot-running build stays alive by never
 * stopping, a synergy a slow tank cannot use. Same code on bench and arena, so
 * the workshop's flank-speed thermal prediction reflects it.
 */
export const RAM_AIR_MAX_BONUS = 0.5;

/** Thermocouple skin (docs/04 §4b): heat-pull rate (kW per °C above ambient) and
 * the fraction of pulled heat that becomes charge (thermodynamic efficiency). */
export const THERMOCOUPLE_K = 0.5;
export const THERMOCOUPLE_EFFICIENCY = 0.5;

export interface SimCommand {
  weaponsEnabled: Record<string, boolean>;
  speedSetting: SpeedSetting;
  /** Environmental radiator multiplier (e.g. wading through water, docs/03 §2). Default 1. */
  radiatorMult?: number;
  /** Physical context for dynamic modifiers (docs/04 §4b). Defaults: 0, 'open'. */
  speedMps?: number;
  tile?: TerrainType;
}

export interface ShotEvent {
  tSec: number;
  instanceId: string;
  partId: string;
  totalDamage: number;
}

export interface CookoffEvent {
  tSec: number;
  instanceId: string;
}

export interface SimSnapshot {
  tSec: number;
  cellTempsC: Record<string, number>;
  shedInstanceIds: string[];
  /**
   * Share of the commanded locomotion draw the core's network could actually
   * feed, 0..1 (1 when the throttle is stationary or fully powered). The arena
   * scales speed by it: a bus that cannot cover flank makes the mech slower,
   * not immobile (see the locomotion note in this file's header).
   */
  locomotionPowerFrac: number;
  shutdownInstanceIds: string[];
  cookedOffInstanceIds: string[];
  totalSupplyKw: number;
  totalDemandKw: number;
  capacitorStoredKj: Record<string, number>;
  shotsThisTick: ShotEvent[];
  cookoffsThisTick: CookoffEvent[];
}

export interface InstanceRuntime {
  isShed: boolean;
  shedSinceT: number | null;
  isShutdown: boolean;
  cumulativeDamageHp: number;
  cookedOff: boolean;
  /** Set by the arena when the part's HP reaches 0 (docs/01 §5). Wreck cells keep conducting heat but the part does nothing. */
  destroyed: boolean;
  cycleTimer: number;
  chargeKj: number;
  capDrawnKj: number;
  cooldownRemainingS: number;
}

const HYSTERESIS_MIN_OFF_S = 1.0;
const HYSTERESIS_HEADROOM_FRAC = 0.10;

function freshRuntime(): InstanceRuntime {
  return {
    isShed: false, shedSinceT: null, isShutdown: false, cumulativeDamageHp: 0,
    cookedOff: false, destroyed: false, cycleTimer: 0, chargeKj: 0, capDrawnKj: 0, cooldownRemainingS: 0,
  };
}

export class Simulation {
  readonly chassis: ChassisSpec;
  readonly parts: PlacedPart[];
  readonly build: Build;
  readonly thermal: ThermalModel;
  readonly massT: number;

  private tSec = 0;
  private reactorAvailableKw = new Map<string, number>();
  private capacitorStoredKj = new Map<string, number>();
  private runtime = new Map<string, InstanceRuntime>();
  private networks: SpatialPowerNetwork[];
  private networkIdByInstance = new Map<string, string>();
  private routeCapacityKwByInstance = new Map<string, number>();
  private coreNetworkId: string | null;
  /** Load- and CoG-derated forward speed (docs/03 §3), shared with derivedStats.ts's workshop stats. */
  private loadScaledFwdMps: number;
  /** Instances whose modifiers force them to shed first (docs/04 §4 Miswired). */
  private shedFirstIds = new Set<string>();
  /** Instances with first claim on power — brownout-immune (docs/04 §4b Surge gate). */
  private firstPriorityIds = new Set<string>();
  /** Capacitor instances that harvest their cells' heat into charge (Thermocouple skin). */
  private heatHarvestIds = new Set<string>();
  private coveredHeatMultByInstance = new Map<string, number>();

  constructor(chassis: ChassisSpec, build: Build) {
    this.chassis = chassis;
    this.build = build;
    this.parts = build.parts;
    this.thermal = buildThermalModel(chassis, build.parts, build.routes);
    const massAndCoG = computeMassAndCoG(chassis, build.parts, build.routes);
    this.massT = massAndCoG.totalMassT;
    this.loadScaledFwdMps = computeLoadScaledSpeeds(chassis, massAndCoG).fwd;

    const spatialPower = resolveSpatialPower(chassis, build);
    const { networks } = spatialPower;
    this.networks = networks;
    for (const net of networks) {
      for (const id of [...net.reactorInstanceIds, ...net.memberInstanceIds]) {
        this.networkIdByInstance.set(id, net.networkId);
      }
      for (const [id, capacity] of Object.entries(net.capacityKwByInstance)) {
        this.routeCapacityKwByInstance.set(id, capacity);
      }
    }
    this.coreNetworkId = spatialPower.coreNetworkId;

    for (const p of build.parts) {
      const def = getPart(p.partId);
      if (def.category === 'reactor') this.reactorAvailableKw.set(p.instanceId, 0);
      if (def.category === 'capacitor') this.capacitorStoredKj.set(p.instanceId, def.capacitor!.storedKj);
      const rt = freshRuntime();
      // Cycle-fed weapons enter battle loaded: the first shot doesn't wait a
      // full cycle (matters for long-cycle weapons like the rocket pod).
      // Keyed on "fires off a cycle timer", not on having a reactor draw:
      // ballistic guns fire mechanically now and would otherwise start a full
      // cycle behind, losing their first shot.
      if (def.weapon && (def.draw?.continuousKw || firesMechanically(def))) rt.cycleTimer = def.weapon.cycleS;
      this.runtime.set(p.instanceId, rt);
      const staticM = effectiveMults(p, STATIC_CTX);
      if (staticM.shedFirst) this.shedFirstIds.add(p.instanceId);
      if (staticM.firstPriority) this.firstPriorityIds.add(p.instanceId);
      if (staticM.harvestsHeat) this.heatHarvestIds.add(p.instanceId);
    }
    this.runtime.set(CORE_INSTANCE_ID, freshRuntime());
    this.refreshSpatialProtection();
    // Victory wrecks remain installed at 0% condition. They occupy/protect
    // cells but must not conduct power or function until repaired.
    for (const p of build.parts) {
      if (p.integrity <= 0) this.destroyPart(p.instanceId);
    }
  }

  /** Re-evaluate sealed coverage when armour becomes or starts as a wreck. */
  private refreshSpatialProtection(): void {
    // Shared with the resolver below, which would otherwise build a second
    // copy of the same static occupancy on every wreck.
    const occupancy = cachedOccupancy(this.chassis, this.build);
    const active = (instanceId: string) => {
      const part = this.parts.find((candidate) => candidate.instanceId === instanceId);
      return Boolean(part && part.integrity > 0 && !this.runtime.get(instanceId)?.destroyed);
    };
    // Zone heat (whole-footprint, multiplies) times armour cover (per-cell,
    // maxes) -- both resolved in one place now, so the sim and the workshop
    // inspector cannot disagree about what a shell is worth.
    //
    // This method is already the gating hook the resolver wants: it re-runs
    // whenever armour becomes a wreck, and its result is cached in
    // `coveredHeatMultByInstance`, which the thermal step reads five times a
    // tick. That shape was right; only the reduction moved.
    //
    // One semantic was chosen rather than preserved. This took the *topmost*
    // active shell's multiplier; `placementEffects.ts` took the *max* over
    // everything above. Only `U-SHELL` declares `coveredHeatMultiplier`, so the
    // two agree on today's catalog -- but they are different rules, and the
    // resolver keeps max, which is the one the inspector already showed the
    // player.
    const effects = resolveBuildEffects(this.chassis, this.build, active);
    for (const part of this.parts) {
      this.coveredHeatMultByInstance.set(
        part.instanceId,
        effects.byInstance.get(part.instanceId)?.heatMultiplier
          ?? INSTANCE_KNOBS.heatMultiplier.neutral,
      );
    }
    for (const cell of this.thermal.cells.values()) {
      if (cell.instanceId === CORE_INSTANCE_ID || cell.isCoolant) continue;
      const stack = occupancy.stacksByCell.get(spatialCellKey(this.chassis, {
        regionId: cell.regionId, x: cell.x, y: cell.y,
      })) ?? [];
      const ownLayer = stack.find((entry) => entry.instanceId === cell.instanceId)?.layer;
      cell.passiveCoolingBlocked = ownLayer !== 'armour' && stack.some((entry) =>
        active(entry.instanceId)
        && entry.layer === 'armour'
        && getPart(entry.partId).spatial?.blocksPassiveCooling === true);
    }
  }

  /** Capacitor charge levels in build-parts order — for lockstep state hashing. */
  capacitorLevels(): number[] {
    const out: number[] = [];
    for (const p of this.parts) {
      const kj = this.capacitorStoredKj.get(p.instanceId);
      if (kj !== undefined) out.push(kj);
    }
    return out;
  }

  /**
   * Deposit heat into one cell by key (system-attacking weapons — the flamer,
   * docs/07 Track C §4). No-op off-grid. Next tick's conduction/threshold pass
   * picks it up like any other heat, so it can shut down or burn down the part.
   */
  depositHeatAtCell(cellKey: string, kj: number): void {
    const cell = this.thermal.cells.get(cellKey);
    if (cell) cell.tempC += kj / cell.thermalMassKjPerC;
  }

  /**
   * Drain up to `kj` of stored capacitor charge, proportionally across banks
   * (the ion cannon, docs/07 Track C §4). Returns the amount actually drained.
   */
  drainCapacitorChargeKj(kj: number): number {
    let total = 0;
    for (const v of this.capacitorStoredKj.values()) total += v;
    if (total <= 0) return 0;
    const frac = Math.min(1, kj / total);
    for (const [id, stored] of this.capacitorStoredKj) {
      this.capacitorStoredKj.set(id, stored - stored * frac);
    }
    return total * frac;
  }

  /** Mean temperature of a part's cells, °C — the dynamic-modifier input. */
  meanCellC(instanceId: string): number {
    const keys = this.thermal.cellKeysByInstance.get(instanceId) ?? [];
    if (keys.length === 0) return AMBIENT_C;
    let sum = 0;
    for (const k of keys) sum += this.thermal.cells.get(k)!.tempC;
    return sum / keys.length;
  }

  isDestroyed(instanceId: string): boolean {
    return this.runtime.get(instanceId)?.destroyed === true;
  }

  /**
   * Marks a part destroyed (docs/01 §5): its cells become wreck cells (still
   * conduct heat at 1.0 kJ/degC thermal mass, no function), and the power
   * networks are recomputed without it -- destroying a conduit mid-fight
   * splits the network and orphans downstream parts immediately.
   */
  destroyPart(instanceId: string): void {
    const rt = this.runtime.get(instanceId);
    if (!rt || rt.destroyed) return;
    rt.destroyed = true;
    if (this.reactorAvailableKw.has(instanceId)) this.reactorAvailableKw.set(instanceId, 0);
    if (this.capacitorStoredKj.has(instanceId)) this.capacitorStoredKj.set(instanceId, 0);
    for (const key of this.thermal.cellKeysByInstance.get(instanceId) ?? []) {
      this.thermal.cells.get(key)!.thermalMassKjPerC = 1.0;
    }
    const destroyedDef = this.parts.find((part) => part.instanceId === instanceId);
    if (destroyedDef && getPart(destroyedDef.partId).spatial?.transfersHeat === true) {
      const destroyedCells = new Set(this.thermal.cellKeysByInstance.get(instanceId) ?? []);
      this.thermal.edges = this.thermal.edges.filter((edge) =>
        !destroyedCells.has(edge.aKey) && !destroyedCells.has(edge.bKey));
    }
    this.refreshSpatialProtection();

    const active = this.parts.filter((p) => !this.isDestroyed(p.instanceId));
    const spatialPower = resolveSpatialPower(
      this.chassis, { ...this.build, parts: active }, new Set(active.map((part) => part.instanceId)),
    );
    const { networks } = spatialPower;
    this.networks = networks;
    this.networkIdByInstance = new Map();
    this.routeCapacityKwByInstance = new Map();
    for (const net of networks) {
      for (const id of [...net.reactorInstanceIds, ...net.memberInstanceIds]) {
        this.networkIdByInstance.set(id, net.networkId);
      }
      for (const [id, capacity] of Object.entries(net.capacityKwByInstance)) {
        this.routeCapacityKwByInstance.set(id, capacity);
      }
    }
    this.coreNetworkId = spatialPower.coreNetworkId;
  }

  private reactorsInNetwork(networkId: string): PlacedPart[] {
    const net = this.networks.find((n) => n.networkId === networkId);
    if (!net) return [];
    return this.parts.filter((p) => net.reactorInstanceIds.includes(p.instanceId));
  }

  private capacitorsInNetwork(networkId: string): PlacedPart[] {
    const net = this.networks.find((n) => n.networkId === networkId);
    if (!net) return [];
    return this.parts.filter(
      (p) => net.memberInstanceIds.includes(p.instanceId) && getPart(p.partId).category === 'capacitor',
    );
  }

  private hottestCellC(instanceId: string): number {
    const keys = this.thermal.cellKeysByInstance.get(instanceId) ?? [];
    let max = AMBIENT_C;
    for (const k of keys) {
      const t = this.thermal.cells.get(k)!.tempC;
      if (t > max) max = t;
    }
    return max;
  }

  step(dtSec: number, command: SimCommand): SimSnapshot {
    this.tSec += dtSec;
    const shotsThisTick: ShotEvent[] = [];
    const cookoffsThisTick: CookoffEvent[] = [];
    const heatDepositKj = new Map<string, number>(); // per cell key

    // Dynamic modifier resolution (docs/04 §4b): per-instance effective
    // multipliers against this tick's physical context. Unmodified parts hit
    // the shared neutral fast path.
    const speedMps = command.speedMps ?? 0;
    const tile = command.tile ?? 'open';
    const multsById = new Map<string, EffectiveMults>();
    for (const p of this.parts) {
      if (!p.modifiers?.length && !p.variant) continue;
      multsById.set(p.instanceId, effectiveMults(p, { tempC: this.meanCellC(p.instanceId), speedMps, tile }));
    }
    const M = (id: string): Readonly<EffectiveMults> => multsById.get(id) ?? NEUTRAL_MULTS;

    const addHeat = (cellKeys: string[], totalKj: number) => {
      const per = totalKj / cellKeys.length;
      for (const k of cellKeys) heatDepositKj.set(k, (heatDepositKj.get(k) ?? 0) + per);
    };

    // --- 1. Reactor spin-up toward rated output ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'reactor' || this.isDestroyed(p.instanceId)) continue;
      const target = def.reactor!.outputKw * M(p.instanceId).outputKw;
      const rate = def.reactor!.throttleLagS > 0 ? target / def.reactor!.throttleLagS : Infinity;
      const cur = this.reactorAvailableKw.get(p.instanceId) ?? 0;
      this.reactorAvailableKw.set(p.instanceId, Math.min(target, cur + rate * dtSec));
    }

    // --- 2. Cap-fed weapon draw (railgun): drains capacitors directly, never competes for reactor priority ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'weapon' || !def.draw?.capFedEnergyPerShotKj) continue;
      const rt = this.runtime.get(p.instanceId)!;
      const enabled = command.weaponsEnabled[p.instanceId] === true;
      if (rt.cookedOff || rt.destroyed) continue;
      rt.isShutdown = this.hottestCellC(p.instanceId) >= HEAT_SHUTDOWN_C ? true : rt.isShutdown && this.hottestCellC(p.instanceId) >= HEAT_RESTART_C;
      if (rt.cooldownRemainingS > 0) rt.cooldownRemainingS -= dtSec;
      if (!enabled || rt.isShutdown || rt.cooldownRemainingS > 0) continue;

      const networkId = this.networkIdByInstance.get(p.instanceId);
      const caps = networkId ? this.capacitorsInNetwork(networkId) : [];
      const energyNeeded = def.draw.capFedEnergyPerShotKj - rt.capDrawnKj;
      const dumpLimitKw = def.draw.capFedEnergyPerShotKj / 1.0; // "dump <= energy over 1.0s" per docs/02 §2
      const pooledDischargeKw = caps.reduce((s, c) => s + getPart(c.partId).capacitor!.dischargeKw, 0);
      const availableStoredKj = caps.reduce((s, c) => s + (this.capacitorStoredKj.get(c.instanceId) ?? 0), 0);
      const drawKw = Math.min(dumpLimitKw, pooledDischargeKw, availableStoredKj / dtSec);
      const drawKj = Math.max(0, Math.min(energyNeeded, drawKw * dtSec));

      // Drain proportionally to each capacitor's stored energy share.
      if (drawKj > 0 && availableStoredKj > 0) {
        for (const c of caps) {
          const stored = this.capacitorStoredKj.get(c.instanceId) ?? 0;
          const share = drawKj * (stored / availableStoredKj);
          this.capacitorStoredKj.set(c.instanceId, Math.max(0, stored - share));
        }
        rt.capDrawnKj += drawKj;
      }
      if (rt.capDrawnKj >= def.draw.capFedEnergyPerShotKj) {
        shotsThisTick.push({ tSec: this.tSec, instanceId: p.instanceId, partId: p.partId, totalDamage: def.weapon!.damage * M(p.instanceId).damage });
        if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(p.instanceId)!, def.heat.heatPerShotKj * (this.coveredHeatMultByInstance.get(p.instanceId) ?? 1));
        rt.capDrawnKj = 0;
        rt.cooldownRemainingS = def.weapon!.cycleS * M(p.instanceId).cycleS;
      }
    }

    // --- 3. Determine requested reactor-fed draw per instance ---
    const requestedKw = new Map<string, number>();
    const networkOf = new Map<string, string>();

    if (this.coreNetworkId && command.speedSetting !== 'stationary') {
      const fraction = SPEED_SETTING_FRACTIONS[command.speedSetting];
      const speedMps = this.loadScaledFwdMps * fraction; // straight-line test bench, load-derated (see file header)
      const kw = 1.2 * this.massT * speedMps;
      requestedKw.set(CORE_INSTANCE_ID, kw);
      networkOf.set(CORE_INSTANCE_ID, this.coreNetworkId);
    }

    for (const p of this.parts) {
      const def = getPart(p.partId);
      const networkId = this.networkIdByInstance.get(p.instanceId);
      if (!networkId) continue; // not connected -- draws nothing, does nothing (docs/01 §3)
      const rt = this.runtime.get(p.instanceId)!;
      rt.isShutdown = this.hottestCellC(p.instanceId) >= HEAT_SHUTDOWN_C ? true : rt.isShutdown && this.hottestCellC(p.instanceId) >= HEAT_RESTART_C;
      if (rt.cookedOff || rt.isShutdown || rt.destroyed) continue;

      let kw = 0;
      if (def.category === 'weapon') {
        const enabled = command.weaponsEnabled[p.instanceId] === true;
        if (enabled) {
          if (def.draw?.continuousKw) kw = def.draw.continuousKw * M(p.instanceId).drawKw;
          else if (def.draw?.chargedEnergyPerShotKj && rt.cooldownRemainingS <= 0) {
            kw = (def.draw.maxChargeKw ?? 0) * M(p.instanceId).drawKw;
          }
        }
      } else if (def.draw?.continuousKw) {
        kw = def.draw.continuousKw * M(p.instanceId).drawKw; // always-on utility (targeting computer, servo booster)
      }
      if (kw > 0) { requestedKw.set(p.instanceId, kw); networkOf.set(p.instanceId, networkId); }
      if (def.draw?.chargedEnergyPerShotKj && rt.cooldownRemainingS > 0) rt.cooldownRemainingS -= dtSec;
    }

    // --- 4. Per-network greedy priority acceptance + brownout shedding (docs/02 §2) ---
    const shedInstanceIds: string[] = [];
    let locomotionPowerFrac = 1;
    let totalSupplyKw = 0;
    let totalDemandKw = 0;
    const deliveredKw = new Map<string, number>();

    for (const net of this.networks) {
      const supplyKw = this.reactorsInNetwork(net.networkId)
        .reduce((s, r) => s + (this.reactorAvailableKw.get(r.instanceId) ?? 0), 0);
      totalSupplyKw += supplyKw;

      const caps = this.capacitorsInNetwork(net.networkId);
      const pooledDischargeKw = caps.reduce((s, c) => s + getPart(c.partId).capacitor!.dischargeKw, 0);
      const availableStoredKj = caps.reduce((s, c) => s + (this.capacitorStoredKj.get(c.instanceId) ?? 0), 0);
      const capBudgetKw = Math.min(pooledDischargeKw, availableStoredKj / dtSec);
      const totalBudgetKw = supplyKw + capBudgetKw;

      const candidateIds = [...requestedKw.keys()].filter((id) => networkOf.get(id) === net.networkId);
      const ranked = [
        ...this.build.powerPriority.filter((id) => candidateIds.includes(id)),
        ...candidateIds.filter((id) => !this.build.powerPriority.includes(id)),
      ];
      // Modifier-driven acceptance order (docs/04 §4/§4b): Surge gate takes
      // first claim on the reactor+capacitor budget (brownout-immune until the
      // caps actually empty); Miswired is forced to the back (shed first).
      const priorityOrder = [
        ...ranked.filter((id) => this.firstPriorityIds.has(id)),
        ...ranked.filter((id) => !this.firstPriorityIds.has(id) && !this.shedFirstIds.has(id)),
        ...ranked.filter((id) => this.shedFirstIds.has(id)),
      ];

      let runningTotal = 0;
      for (const id of priorityOrder) {
        const kw = requestedKw.get(id)!;
        totalDemandKw += kw;
        const rt = this.runtime.get(id)!;
        const tentative = runningTotal + kw;
        const routeCapacity = this.routeCapacityKwByInstance.get(id) ?? Infinity;

        // Locomotion is a continuous load, not a box that is on or off: its
        // draw is already 1.2 kW per tonne per m/s, so a bus that covers 80% of
        // the commanded flank draw moves the mech at 80% of flank. Shedding it
        // whole — the workshop test bench's simplification, which this file's
        // header flags as the arena's to extend — froze a mech solid for a whole
        // battle whenever its core network could not cover flank. Three shipped
        // starting builds did exactly that: they stood on the spawn mark,
        // unable to close, and lost without firing a shot, which is what a
        // player reported as the mech not attacking.
        if (id === CORE_INSTANCE_ID) {
          const affordable = Math.max(0, Math.min(routeCapacity, totalBudgetKw - runningTotal));
          const delivered = Math.min(kw, affordable);
          locomotionPowerFrac = kw > 0 ? delivered / kw : 1;
          if (delivered <= 0) {
            rt.isShed = true;
            rt.shedSinceT ??= this.tSec;
            shedInstanceIds.push(id);
            continue;
          }
          rt.isShed = false;
          rt.shedSinceT = null;
          runningTotal += delivered;
          deliveredKw.set(id, delivered);
          continue;
        }

        if (kw > routeCapacity) {
          rt.isShed = true;
          rt.shedSinceT ??= this.tSec;
          shedInstanceIds.push(id);
          continue;
        }

        if (rt.isShed) {
          const elapsedOk = rt.shedSinceT !== null && this.tSec - rt.shedSinceT >= HYSTERESIS_MIN_OFF_S;
          const headroomOk = totalBudgetKw > 0 && (totalBudgetKw - runningTotal) / totalBudgetKw >= HYSTERESIS_HEADROOM_FRAC;
          if (!(elapsedOk && headroomOk && tentative <= totalBudgetKw)) {
            shedInstanceIds.push(id);
            continue;
          }
        } else if (tentative > totalBudgetKw) {
          rt.isShed = true;
          rt.shedSinceT = this.tSec;
          shedInstanceIds.push(id);
          continue;
        }

        rt.isShed = false;
        rt.shedSinceT = null;
        runningTotal = tentative;
        deliveredKw.set(id, kw);
      }

      // --- 5. Capacitor discharge (cover shortfall) / charge (use headroom) ---
      const shortfallKw = Math.max(0, runningTotal - supplyKw);
      const headroomKw = Math.max(0, supplyKw - runningTotal);
      if (shortfallKw > 0 && availableStoredKj > 0) {
        for (const c of caps) {
          const stored = this.capacitorStoredKj.get(c.instanceId) ?? 0;
          const share = shortfallKw * dtSec * (stored / availableStoredKj);
          this.capacitorStoredKj.set(c.instanceId, Math.max(0, stored - share));
        }
      }
      if (headroomKw > 0) {
        const chargeKw = Math.min(headroomKw, caps.reduce((s, c) => s + getPart(c.partId).capacitor!.chargeKw, 0));
        for (const c of caps) {
          const capDef = getPart(c.partId).capacitor!;
          const stored = this.capacitorStoredKj.get(c.instanceId) ?? 0;
          const room = capDef.storedKj - stored;
          const share = Math.min(room, (chargeKw * dtSec) / caps.length);
          this.capacitorStoredKj.set(c.instanceId, stored + Math.max(0, share));
        }
      }
    }

    // --- 6. Resolve firing for reactor-fed weapons + locomotion/idle heat ---
    for (const [id, kw] of deliveredKw) {
      if (id === CORE_INSTANCE_ID) {
        if (command.speedSetting === 'flank') {
          // Scaled by what the bus actually fed: a drive running at 80% power
          // does 80% of the work, and dumps 80% of the waste heat.
          addHeat([...this.thermal.cellKeysByInstance.get(CORE_INSTANCE_ID)!], 0.15 * this.massT * dtSec * locomotionPowerFrac);
        }
        continue;
      }
      const part = this.parts.find((p) => p.instanceId === id)!;
      const def = getPart(part.partId);
      const rt = this.runtime.get(id)!;
      if (def.category !== 'weapon') continue;

      const eff = M(id);
      if (def.draw?.continuousKw) {
        const cycleS = def.weapon!.cycleS * eff.cycleS;
        rt.cycleTimer += dtSec;
        while (rt.cycleTimer >= cycleS) {
          rt.cycleTimer -= cycleS;
          const totalDamage = def.weapon!.damage * eff.damage * (def.weapon!.salvoCount ?? 1);
          shotsThisTick.push({ tSec: this.tSec, instanceId: id, partId: part.partId, totalDamage });
          if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(id)!, def.heat.heatPerShotKj * (this.coveredHeatMultByInstance.get(id) ?? 1));
        }
      } else if (def.draw?.chargedEnergyPerShotKj) {
        rt.chargeKj += kw * dtSec;
        if (rt.chargeKj >= def.draw.chargedEnergyPerShotKj) {
          shotsThisTick.push({ tSec: this.tSec, instanceId: id, partId: part.partId, totalDamage: def.weapon!.damage * eff.damage });
          if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(id)!, def.heat.heatPerShotKj * (this.coveredHeatMultByInstance.get(id) ?? 1));
          rt.chargeKj = 0;
          rt.cooldownRemainingS = def.weapon!.cycleS * eff.cycleS - (def.draw.minChargeS ?? 0);
        }
      }
    }

    // --- 6b. Resolve firing for weapons the bus does not feed ---
    //
    // The loop above is driven by `deliveredKw`, so it can only ever fire a
    // weapon that was handed power this tick. A ballistic gun is not, and must
    // not be: brownout immunity is the whole point of the class. It fires here
    // instead, off its cycle timer alone.
    //
    // Everything else still applies. It has to be wired (fire control and the
    // feed motor earn the connection even though the shot does not draw), it
    // stops when the part overheats, and it makes the same heat -- so a
    // ballistic build trades power fragility for a thermal ceiling rather than
    // getting a gun with no limiter at all.
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (!firesMechanically(def)) continue;
      if (!this.networkIdByInstance.has(p.instanceId)) continue;
      const rt = this.runtime.get(p.instanceId)!;
      if (rt.destroyed || rt.isShutdown || rt.cookedOff) continue;
      if (command.weaponsEnabled[p.instanceId] !== true) continue;

      const eff = M(p.instanceId);
      const cycleS = def.weapon!.cycleS * eff.cycleS;
      rt.cycleTimer += dtSec;
      while (rt.cycleTimer >= cycleS) {
        rt.cycleTimer -= cycleS;
        const totalDamage = def.weapon!.damage * eff.damage * (def.weapon!.salvoCount ?? 1);
        shotsThisTick.push({ tSec: this.tSec, instanceId: p.instanceId, partId: p.partId, totalDamage });
        if (def.heat?.heatPerShotKj) {
          addHeat(
            this.thermal.cellKeysByInstance.get(p.instanceId)!,
            def.heat.heatPerShotKj * (this.coveredHeatMultByInstance.get(p.instanceId) ?? 1),
          );
        }
      }
    }

    // --- 7. Reactor waste heat ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'reactor' || this.isDestroyed(p.instanceId)) continue;
      const delivered = this.reactorsUsedKw(p.instanceId, deliveredKw);
      const output = def.reactor!.outputKw;
      const utilization = output > 0 ? delivered / output : 0;
      const wasteKw = Array.isArray(def.reactor!.wasteHeatKw)
        ? (utilization <= 0.5 ? def.reactor!.wasteHeatKw[0] : def.reactor!.wasteHeatKw[1])
        : def.reactor!.wasteHeatKw;
      addHeat(this.thermal.cellKeysByInstance.get(p.instanceId)!, wasteKw * dtSec * (this.coveredHeatMultByInstance.get(p.instanceId) ?? 1));
    }

    // --- 7b. Modifier heat (Hot-running, Leaky): extra emission while the
    // part is connected and alive ---
    for (const [id, m] of multsById) {
      if (m.extraHeatKw <= 0 || this.isDestroyed(id) || !this.networkIdByInstance.has(id)) continue;
      addHeat(this.thermal.cellKeysByInstance.get(id)!, m.extraHeatKw * dtSec * (this.coveredHeatMultByInstance.get(id) ?? 1));
    }

    // --- 8. Apply deposited heat ---
    for (const [key, kj] of heatDepositKj) {
      const cell = this.thermal.cells.get(key)!;
      cell.tempC += kj / cell.thermalMassKjPerC;
    }

    // --- 9. Conduction (explicit Euler; see file header) ---
    const conductionDeltaKj = new Map<string, number>();
    for (const edge of this.thermal.edges) {
      const a = this.thermal.cells.get(edge.aKey)!;
      const b = this.thermal.cells.get(edge.bKey)!;
      const qKw = edge.k * (a.tempC - b.tempC);
      const kj = qKw * dtSec;
      conductionDeltaKj.set(edge.aKey, (conductionDeltaKj.get(edge.aKey) ?? 0) - kj);
      conductionDeltaKj.set(edge.bKey, (conductionDeltaKj.get(edge.bKey) ?? 0) + kj);
    }
    for (const [key, kj] of conductionDeltaKj) {
      const cell = this.thermal.cells.get(key)!;
      cell.tempC += kj / cell.thermalMassKjPerC;
    }

    // --- 10. Radiators (with ram-air speed bonus and environmental multiplier) ---
    const ramAir = (1 + RAM_AIR_MAX_BONUS * SPEED_SETTING_FRACTIONS[command.speedSetting]) * (command.radiatorMult ?? 1);
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.id !== 'U-RAD' || this.isDestroyed(p.instanceId)) continue;
      const radMult = M(p.instanceId).radiator;
      const keys = this.thermal.cellKeysByInstance.get(p.instanceId)!;
      const raws = keys.map((k) => {
        const cell = this.thermal.cells.get(k)!;
        return { key: k, raw: Math.max(0, RADIATOR_K * radMult * (command.radiatorMult ?? 1) * (cell.tempC - AMBIENT_C)) };
      });
      const rawTotal = raws.reduce((s, r) => s + r.raw, 0);
      const factor = rawTotal > 0 ? Math.min(1, (RADIATOR_CAP_KW * radMult * ramAir) / rawTotal) : 0;
      for (const { key, raw } of raws) {
        const cell = this.thermal.cells.get(key)!;
        cell.tempC -= (raw * factor * ramAir * dtSec) / cell.thermalMassKjPerC;
      }
    }

    // Exterior cells radiate a small amount without a dedicated radiator.
    // A sealed shell cools itself but blocks this bonus on the equipment below.
    for (const cell of this.thermal.cells.values()) {
      if (!cell.isPerimeter || cell.passiveCoolingBlocked || cell.tempC <= AMBIENT_C) continue;
      const qKj = EXTERIOR_PASSIVE_K * (cell.tempC - AMBIENT_C) * dtSec;
      cell.tempC -= qKj / cell.thermalMassKjPerC;
    }

    // --- 10b. Thermocouple skin (docs/04 §4b): a modded capacitor bleeds its
    // own cells' heat-above-ambient back into charge at THERMOCOUPLE_EFFICIENCY.
    // Conduction (§9) carries reactor/weapon waste heat into the cap's cells,
    // so sitting it next to a hot reactor turns waste heat into ammo.
    for (const id of this.heatHarvestIds) {
      if (this.isDestroyed(id)) continue;
      const capDef = getPart(this.parts.find((p) => p.instanceId === id)!.partId).capacitor!;
      let stored = this.capacitorStoredKj.get(id) ?? 0;
      for (const key of this.thermal.cellKeysByInstance.get(id)!) {
        const cell = this.thermal.cells.get(key)!;
        const above = cell.tempC - AMBIENT_C;
        if (above <= 0) continue;
        const pulledKj = THERMOCOUPLE_K * above * dtSec;
        cell.tempC -= pulledKj / cell.thermalMassKjPerC;
        stored = Math.min(capDef.storedKj, stored + pulledKj * THERMOCOUPLE_EFFICIENCY);
      }
      this.capacitorStoredKj.set(id, stored);
    }

    // --- 11. Threshold checks: shutdown / damage / cook-off ---
    const shutdownInstanceIds: string[] = [];
    const cookedOffInstanceIds: string[] = [];
    for (const p of this.parts) {
      const rt = this.runtime.get(p.instanceId)!;
      if (rt.destroyed) continue;
      const hottest = this.hottestCellC(p.instanceId);
      if (!rt.isShutdown && hottest >= HEAT_SHUTDOWN_C) rt.isShutdown = true;
      if (rt.isShutdown && hottest < 110) rt.isShutdown = false;
      if (rt.isShutdown) shutdownInstanceIds.push(p.instanceId);

      if (hottest >= HEAT_DAMAGE_C) rt.cumulativeDamageHp += ((hottest - HEAT_DAMAGE_C) / 10) * dtSec;

      if (hottest >= 180 && p.partId === 'U-AMMO' && !rt.cookedOff) {
        rt.cookedOff = true;
        cookoffsThisTick.push({ tSec: this.tSec, instanceId: p.instanceId });
      }
      if (rt.cookedOff) cookedOffInstanceIds.push(p.instanceId);
    }

    const cellTempsC: Record<string, number> = {};
    for (const [key, cell] of this.thermal.cells) cellTempsC[key] = cell.tempC;
    const capacitorStoredKj: Record<string, number> = {};
    for (const [id, kj] of this.capacitorStoredKj) capacitorStoredKj[id] = kj;

    return {
      tSec: this.tSec, cellTempsC, shedInstanceIds, locomotionPowerFrac, shutdownInstanceIds, cookedOffInstanceIds,
      totalSupplyKw, totalDemandKw, capacitorStoredKj, shotsThisTick, cookoffsThisTick,
    };
  }

  private reactorsUsedKw(reactorInstanceId: string, deliveredKw: Map<string, number>): number {
    // Reactor "utilization" is approximated as this reactor's share of its
    // network's delivered load, proportional to its rated output.
    const networkId = this.networkIdByInstance.get(reactorInstanceId);
    const net = this.networks.find((n) => n.networkId === networkId);
    if (!net) return 0;
    const reactors = this.reactorsInNetwork(networkId!);
    const totalOutput = reactors.reduce((s, r) => s + getPart(r.partId).reactor!.outputKw, 0);
    const thisReactorPart = this.parts.find((p) => p.instanceId === reactorInstanceId)!;
    const thisOutput = getPart(thisReactorPart.partId).reactor!.outputKw;
    const totalDelivered = [...deliveredKw.entries()]
      .filter(([id]) => this.networkIdByInstance.get(id) === networkId)
      .reduce((s, [, kw]) => s + kw, 0);
    return totalOutput > 0 ? totalDelivered * (thisOutput / totalOutput) : 0;
  }

  get instanceRuntime(): ReadonlyMap<string, InstanceRuntime> {
    return this.runtime;
  }
}
