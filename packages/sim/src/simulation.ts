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
import { getPart } from './catalog.js';
import { computeCoreNetwork, computeLoadScaledSpeeds, computeMassAndCoG, computePowerNetworks } from './grid.js';
import {
  AMBIENT_C,
  CORE_INSTANCE_ID,
  RADIATOR_CAP_KW,
  RADIATOR_K,
  buildThermalModel,
  type ThermalModel,
} from './thermal.js';

export type SpeedSetting = 'stationary' | 'creep' | 'cruise' | 'flank';

export const SPEED_SETTING_FRACTIONS: Record<SpeedSetting, number> = {
  stationary: 0, creep: 0.3, cruise: 0.65, flank: 1.0,
};

export interface SimCommand {
  weaponsEnabled: Record<string, boolean>;
  speedSetting: SpeedSetting;
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
    cookedOff: false, cycleTimer: 0, chargeKj: 0, capDrawnKj: 0, cooldownRemainingS: 0,
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
  private networks: ReturnType<typeof computePowerNetworks>['networks'];
  private networkIdByInstance = new Map<string, string>();
  private coreNetworkId: string | null;
  /** Load- and CoG-derated forward speed (docs/03 §3), shared with derivedStats.ts's workshop stats. */
  private loadScaledFwdMps: number;

  constructor(chassis: ChassisSpec, build: Build) {
    this.chassis = chassis;
    this.build = build;
    this.parts = build.parts;
    this.thermal = buildThermalModel(chassis, build.parts);
    const massAndCoG = computeMassAndCoG(chassis, build.parts);
    this.massT = massAndCoG.totalMassT;
    this.loadScaledFwdMps = computeLoadScaledSpeeds(chassis, massAndCoG).fwd;

    const { networks } = computePowerNetworks(build.parts);
    this.networks = networks;
    for (const net of networks) {
      for (const id of [...net.reactorInstanceIds, ...net.memberInstanceIds]) {
        this.networkIdByInstance.set(id, net.networkId);
      }
    }
    this.coreNetworkId = computeCoreNetwork(chassis, build.parts);

    for (const p of build.parts) {
      const def = getPart(p.partId);
      if (def.category === 'reactor') this.reactorAvailableKw.set(p.instanceId, 0);
      if (def.category === 'capacitor') this.capacitorStoredKj.set(p.instanceId, def.capacitor!.storedKj);
      this.runtime.set(p.instanceId, freshRuntime());
    }
    this.runtime.set(CORE_INSTANCE_ID, freshRuntime());
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

    const addHeat = (cellKeys: string[], totalKj: number) => {
      const per = totalKj / cellKeys.length;
      for (const k of cellKeys) heatDepositKj.set(k, (heatDepositKj.get(k) ?? 0) + per);
    };

    // --- 1. Reactor spin-up toward rated output ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'reactor') continue;
      const target = def.reactor!.outputKw;
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
      if (rt.cookedOff) continue;
      rt.isShutdown = this.hottestCellC(p.instanceId) >= 130 ? true : rt.isShutdown && this.hottestCellC(p.instanceId) >= 110;
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
        shotsThisTick.push({ tSec: this.tSec, instanceId: p.instanceId, partId: p.partId, totalDamage: def.weapon!.damage });
        if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(p.instanceId)!, def.heat.heatPerShotKj);
        rt.capDrawnKj = 0;
        rt.cooldownRemainingS = def.weapon!.cycleS;
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
      rt.isShutdown = this.hottestCellC(p.instanceId) >= 130 ? true : rt.isShutdown && this.hottestCellC(p.instanceId) >= 110;
      if (rt.cookedOff || rt.isShutdown) continue;

      let kw = 0;
      if (def.category === 'weapon') {
        const enabled = command.weaponsEnabled[p.instanceId] === true;
        if (enabled) {
          if (def.draw?.continuousKw) kw = def.draw.continuousKw;
          else if (def.draw?.chargedEnergyPerShotKj && rt.cooldownRemainingS <= 0) {
            kw = def.draw.maxChargeKw ?? 0;
          }
        }
      } else if (def.draw?.continuousKw) {
        kw = def.draw.continuousKw; // always-on utility (targeting computer, servo booster)
      }
      if (kw > 0) { requestedKw.set(p.instanceId, kw); networkOf.set(p.instanceId, networkId); }
      if (def.draw?.chargedEnergyPerShotKj && rt.cooldownRemainingS > 0) rt.cooldownRemainingS -= dtSec;
    }

    // --- 4. Per-network greedy priority acceptance + brownout shedding (docs/02 §2) ---
    const shedInstanceIds: string[] = [];
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
      const priorityOrder = [
        ...this.build.powerPriority.filter((id) => candidateIds.includes(id)),
        ...candidateIds.filter((id) => !this.build.powerPriority.includes(id)),
      ];

      let runningTotal = 0;
      for (const id of priorityOrder) {
        const kw = requestedKw.get(id)!;
        totalDemandKw += kw;
        const rt = this.runtime.get(id)!;
        const tentative = runningTotal + kw;

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
          addHeat([...this.thermal.cellKeysByInstance.get(CORE_INSTANCE_ID)!], 0.15 * this.massT * dtSec);
        }
        continue;
      }
      const part = this.parts.find((p) => p.instanceId === id)!;
      const def = getPart(part.partId);
      const rt = this.runtime.get(id)!;
      if (def.category !== 'weapon') continue;

      if (def.draw?.continuousKw) {
        rt.cycleTimer += dtSec;
        while (rt.cycleTimer >= def.weapon!.cycleS) {
          rt.cycleTimer -= def.weapon!.cycleS;
          const totalDamage = def.weapon!.damage * (def.weapon!.salvoCount ?? 1);
          shotsThisTick.push({ tSec: this.tSec, instanceId: id, partId: part.partId, totalDamage });
          if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(id)!, def.heat.heatPerShotKj);
        }
      } else if (def.draw?.chargedEnergyPerShotKj) {
        rt.chargeKj += kw * dtSec;
        if (rt.chargeKj >= def.draw.chargedEnergyPerShotKj) {
          shotsThisTick.push({ tSec: this.tSec, instanceId: id, partId: part.partId, totalDamage: def.weapon!.damage });
          if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(id)!, def.heat.heatPerShotKj);
          rt.chargeKj = 0;
          rt.cooldownRemainingS = def.weapon!.cycleS - (def.draw.minChargeS ?? 0);
        }
      }
    }

    // --- 7. Reactor waste heat ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'reactor') continue;
      const delivered = this.reactorsUsedKw(p.instanceId, deliveredKw);
      const output = def.reactor!.outputKw;
      const utilization = output > 0 ? delivered / output : 0;
      const wasteKw = Array.isArray(def.reactor!.wasteHeatKw)
        ? (utilization <= 0.5 ? def.reactor!.wasteHeatKw[0] : def.reactor!.wasteHeatKw[1])
        : def.reactor!.wasteHeatKw;
      addHeat(this.thermal.cellKeysByInstance.get(p.instanceId)!, wasteKw * dtSec);
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

    // --- 10. Radiators ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.id !== 'U-RAD') continue;
      const keys = this.thermal.cellKeysByInstance.get(p.instanceId)!;
      const raws = keys.map((k) => {
        const cell = this.thermal.cells.get(k)!;
        return { key: k, raw: Math.max(0, RADIATOR_K * (cell.tempC - AMBIENT_C)) };
      });
      const rawTotal = raws.reduce((s, r) => s + r.raw, 0);
      const factor = rawTotal > 0 ? Math.min(1, RADIATOR_CAP_KW / rawTotal) : 0;
      for (const { key, raw } of raws) {
        const cell = this.thermal.cells.get(key)!;
        cell.tempC -= (raw * factor * dtSec) / cell.thermalMassKjPerC;
      }
    }

    // --- 11. Threshold checks: shutdown / damage / cook-off ---
    const shutdownInstanceIds: string[] = [];
    const cookedOffInstanceIds: string[] = [];
    for (const p of this.parts) {
      const hottest = this.hottestCellC(p.instanceId);
      const rt = this.runtime.get(p.instanceId)!;
      if (!rt.isShutdown && hottest >= 130) rt.isShutdown = true;
      if (rt.isShutdown && hottest < 110) rt.isShutdown = false;
      if (rt.isShutdown) shutdownInstanceIds.push(p.instanceId);

      if (hottest >= 150) rt.cumulativeDamageHp += ((hottest - 150) / 10) * dtSec;

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
      tSec: this.tSec, cellTempsC, shedInstanceIds, shutdownInstanceIds, cookedOffInstanceIds,
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
