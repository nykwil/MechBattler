/**
 * Core data types for the MechBattler simulation.
 *
 * This module has zero rendering dependencies (design rule R6, see
 * docs/00-core-design.md). Everything here is pure data + pure functions so
 * it can run headless in tests, in a browser tab, or later inside a
 * different engine entirely.
 */

export type PartCategory =
  | 'structural'
  | 'utility'
  | 'reactor'
  | 'capacitor'
  | 'weapon';

export type PowerArchetype = 'electric' | 'combustion';

/** A cell offset relative to a part's origin, in its unrotated orientation. */
export interface CellOffset {
  dx: number;
  dy: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Reactor supply characteristics. See docs/02-power-heat-spec.md §2. */
export interface ReactorSpec {
  archetype: PowerArchetype;
  outputKw: number;
  /** Waste heat in kW. Combustion reactors have [lowLoad, highLoad]; electric is a single value. */
  wasteHeatKw: number | [number, number];
  throttleLagS: number;
}

/** Capacitor bank characteristics. See docs/02-power-heat-spec.md §2. */
export interface CapacitorSpec {
  storedKj: number;
  chargeKw: number;
  dischargeKw: number;
}

/** Continuous or per-shot power draw for an active consumer. */
export interface PowerDraw {
  /** Continuous draw in kW while the part is toggled on (e.g. machine gun, autocannon). */
  continuousKw?: number;
  /** Energy per shot in kJ, drawn from capacitors only (railgun-style). */
  capFedEnergyPerShotKj?: number;
  /** Energy per shot in kJ, charged over time from the reactor (laser-style). */
  chargedEnergyPerShotKj?: number;
  /** Minimum charge time in seconds for chargedEnergyPerShotKj weapons. */
  minChargeS?: number;
  /** Max charge rate in kW for chargedEnergyPerShotKj weapons. */
  maxChargeKw?: number;
}

/** Heat generation profile. See docs/02-power-heat-spec.md §3. */
export interface HeatProfile {
  /** Heat deposited per shot/salvo, in kJ, split evenly across the part's cells. */
  heatPerShotKj?: number;
  /** Continuous idle heat in kW while powered (e.g. reactor waste heat is handled via ReactorSpec). */
  idleHeatKw?: number;
}

/** Ballistic weapon stats. See docs/03-combat-spec.md §5. */
export interface WeaponSpec {
  damage: number;
  /** Number of sub-projectiles per shot (e.g. rocket pod salvo). */
  salvoCount?: number;
  cycleS: number;
  projectileSpeed: number | 'hitscan';
  dispersionMrad: number;
  falloff: { rangeStart: number; rangeEnd: number; multAtEnd: number };
  mountArcDeg: number;
  recoilKnS?: number;
  /**
   * System-attacking effects (docs/07 Track C §4, R1-clean — watts and joules,
   * not tags). Applied to the target on each hit, in addition to HP damage:
   */
  /** kJ of heat dumped into the struck enemy cell — attacks the thermal sim (flamer). */
  enemyHeatKj?: number;
  /** kJ of stored capacitor charge drained from the enemy — attacks the power sim (ion). */
  capDrainKj?: number;
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  /** Shape in the part's default (0deg) orientation. */
  shape: CellOffset[];
  massKg: number;
  hp: number;
  tier: 1 | 2 | 3 | 4;
  /** True for parts that may only be placed on chassis perimeter cells (radiators). */
  perimeterOnly?: boolean;
  reactor?: ReactorSpec;
  capacitor?: CapacitorSpec;
  draw?: PowerDraw;
  heat?: HeatProfile;
  weapon?: WeaponSpec;
  /** Structural conduit/pipe conductivity multiplier; see docs/01 §4. */
  isConduit?: boolean;
  isHeatPipe?: boolean;
  /** Thermal mass override in kJ/degC for this part's cells (default 1.0/cell). */
  thermalMassPerCell?: number;
  /** Chassis speed multiplier while this connected utility is functional and powered. */
  speedMult?: number;
}

export interface ChassisSpec {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  /** mask[y][x] === true means the cell exists on this chassis. */
  mask: boolean[][];
  coreCell: { x: number; y: number };
  ratedMassT: number;
  speedsMps: { fwd: number; strafe: number; rev: number };
  turnRateDegS: number;
  accelMps2: number;
}

export interface PlacedPart {
  /** Unique instance id (a chassis can have multiple of the same part id). */
  instanceId: string;
  partId: string;
  origin: { x: number; y: number };
  rotation: Rotation;
  /** 0-1, salvage integrity. 1.0 = pristine. See docs/04 §3. */
  integrity: number;
  /** Modifier ids (quirks/mods, docs/04 §4-§4b) riding this instance forever. */
  modifiers?: string[];
  /** Variant multipliers on catalog stats (docs/04 §4), e.g. { damage: 1.08 }. */
  variant?: Partial<Record<'damage' | 'cycleS' | 'dispersionMrad' | 'hp', number>>;
}

export interface Build {
  chassisId: string;
  parts: PlacedPart[];
  /** Ordered highest-to-lowest; brownout sheds from the end first. See docs/02 §2. */
  powerPriority: string[];
}
