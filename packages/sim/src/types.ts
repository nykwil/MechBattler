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

/** A cell in one local chassis region. `regionId` is optional on legacy data. */
export interface CellRef {
  regionId?: string;
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export type EquipmentLayer = 'support' | 'payload' | 'armour';
export type RouteKind = 'wire' | 'coolant';

export interface PartSpatialSpec {
  /** Damage/occupancy order: armour sits above payload, payload above support. */
  layer?: EquipmentLayer;
  /** Which layer may sit immediately below this part. */
  stacksOn?: EquipmentLayer[];
  /**
   * Levels this part occupies above the floor of its cell. A weapon's cells are
   * its mounting point, not its barrel, so height is what decides whether the
   * thing in front of it is in the way. See the height design spec.
   */
  height?: number;
  /**
   * The ceiling this part imposes on every cell ahead of it in its own lane,
   * measured from its own base. Authored per weapon rather than derived from
   * height: a low turret wants a clear lane, a hull-down mortar blocks nothing.
   */
  clearsForward?: number;
  /** Maximum electrical load that can pass through this part's cells. */
  electricalCapacityKw?: number;
  /** Electrical relay override. Equipment conducts by default; `false` opts out. */
  transfersPower?: boolean;
  /** Relative thermal conductance through this part's cells. */
  thermalConductance?: number;
  /** Allows heat/coolant transfer through this part's cells and ports. */
  transfersHeat?: boolean;
  /** Multiplies generated heat for equipment directly beneath this shell. */
  coveredHeatMultiplier?: number;
  /** Prevents the exterior passive-cooling bonus beneath this shell. */
  blocksPassiveCooling?: boolean;
  /** Arc granted to a weapon directly above this support. */
  weaponArcBonusDeg?: number;
}

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

/**
 * What a weapon consumes to fire, which is the axis the player reads as
 * "energy gun or ammo gun". Purely descriptive today -- no rule branches on it
 * yet -- and it exists first so that any rule which later does has one place to
 * ask, rather than inferring the answer from `draw` (which does not survive
 * contact: `W-RG` is cap-fed but throws a slug, and `W-SC` is a flamer on a
 * continuous draw) or matching part ids (the mistake `simulation.ts`'s
 * hardcoded `'U-AMMO'` cook-off check still makes).
 *
 *  - `ballistic` a chemically or electromagnetically launched slug: MG,
 *    autocannon, carbine, siege gun, and the railgun, which pays an energy cost
 *    on top of the projectile it still has to carry.
 *  - `energy`    nothing physical leaves the mech. Laser, ion.
 *  - `missile`   self-propelled ordnance, reloaded as whole rounds rather than
 *    fed from a belt. Rocket pod.
 *  - `chemical`  burns a fuel to project heat rather than mass. Scald.
 *
 * Four classes rather than two is a deliberate bet that missiles and fuel want
 * different rules from belt-fed guns. If they never earn one, collapsing them
 * into `ballistic` is a one-line change here plus the catalog rows.
 */
export type WeaponClass = 'ballistic' | 'energy' | 'missile' | 'chemical';

/** Weapon stats. See docs/03-combat-spec.md §5. */
export interface WeaponSpec {
  /** What it consumes to fire. See `WeaponClass`. */
  weaponClass: WeaponClass;
  damage: number;
  /** Number of sub-projectiles per shot (e.g. rocket pod salvo). */
  salvoCount?: number;
  cycleS: number;
  projectileSpeed: number | 'hitscan';
  dispersionMrad: number;
  /**
   * Damage against range (docs/03 §5). Four bands, same shape the arena cone draws:
   *
   *   0 → min          empty (×0)
   *   min → idealMin   fade ×0 → ×1
   *   idealMin → idealMax  full (×1) — the sweet spot
   *   idealMax → max   fade ×1 → ×0
   *
   * `min` defaults to 0. Knife-fight guns set `idealMin` to 0 so they stay full
   * at contact. When `min === idealMin` the near fade has zero width (hard floor).
   */
  falloff: {
    /** Hard empty below this. Default 0. */
    min?: number;
    /** Near edge of the full-damage sweet spot. */
    idealMin: number;
    /** Far edge of the full-damage sweet spot. */
    idealMax: number;
    /** Far range where damage reaches ×0. */
    max: number;
  };
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
  /**
   * Mech-wide multiplier on the lateral-target (leading) penalty, applied while
   * this part is functional and powered. A targeting computer is 0.4.
   *
   * Declared here rather than named inside combat.ts so a second fire-control
   * part is a catalog entry, not an engine change. Sources multiply, so two
   * computers are twice as good and cost twice as much; the per-weapon half of
   * the same penalty is `EffectiveMults.lateralPenalty`.
   */
  fireControlLateralMult?: number;
  /** Shared spatial-system behavior. Omitted parts are payload by default. */
  spatial?: PartSpatialSpec;
}

export interface ChassisRegionSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Region-local validity expressed in the common workshop projection. */
  mask: boolean[][];
  /** Top-left position of this region in the separated workshop layout. */
  workshopOrigin?: { x: number; y: number };
  /** Fractional cell offset for centering differently sized regional grids. */
  workshopOffset?: { x: number; y: number };
}

export interface ChassisPortSpec {
  id: string;
  a: CellRef;
  b: CellRef;
}

/**
 * A named, inspectable effect belonging to chassis cells rather than a part.
 * Zones deliberately use a small set of strong mechanical fields so the
 * workshop can explain placement without becoming a cloud of tiny modifiers.
 */
export interface ChassisLocationEffectSpec {
  id: string;
  name: string;
  description: string;
  /** Added to a weapon's authored mount arc when its whole footprint fits. */
  weaponArcBonusDeg?: number;
  /** Multiplies the weapon's complete falloff envelope when wholly fitted. */
  weaponRangeMultiplier?: number;
  /** Multiplies heat generated by equipment wholly fitted in the zone. */
  heatMultiplier?: number;
}

/** A set of cells sharing one authored location effect. */
export interface ChassisLocationZoneSpec {
  id: string;
  cells: CellRef[];
  effect: ChassisLocationEffectSpec;
}

/**
 * A set of cells with an authored roof. Per-cell rather than per-region on
 * purpose: a region-wide roof is too blunt to be usable. The Mule's shoulder
 * regions are two mask rows deep, so a rect(2,3) gun cannot fit in one, and
 * roofing the whole hull would not mean "guns go on the shoulders" -- it would
 * mean the Mule can never mount a big gun at all.
 */
export interface ChassisClearanceZoneSpec {
  id: string;
  name: string;
  cells: CellRef[];
  /** Highest level a part may reach in these cells. */
  height: number;
}

export interface ChassisSpec {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  /** mask[y][x] === true means the cell exists on this chassis. */
  mask: boolean[][];
  coreCell: CellRef;
  ratedMassT: number;
  speedsMps: { fwd: number; strafe: number; rev: number };
  turnRateDegS: number;
  accelMps2: number;
  /** Optional regional topology. Flat legacy chassis implicitly have one `body` region. */
  regions?: ChassisRegionSpec[];
  /** Immutable inter-region sockets. Electrical endpoint equipment can draw through the link. */
  ports?: ChassisPortSpec[];
  /** Named cell-location effects, applied only when a part fits wholly inside a zone. */
  locationZones?: ChassisLocationZoneSpec[];
  /** Authored low roofs, e.g. an interior cargo bay. */
  clearanceZones?: ChassisClearanceZoneSpec[];
  /** Number of non-equipment tickets in the directional hit pool. */
  chassisHitTickets: number;
  /** Global structural body pool. Ordinary hits never target the old core cell. */
  maxIntegrity: number;
  /**
   * How much dispersion this frame pays for crossing speed, against the
   * `MOVE_JITTER_MRAD_PER_MPS` baseline. A scout's gyros are built to shoot on
   * the move; a siege hull is not. Defaults to 1 when omitted.
   *
   * This is the axis that makes mobility defensive at all. Evasion in the hit
   * model is lead error, which only comes from lateral speed, and the autopilot
   * only crosses when its exchange says the accuracy it loses is worth the
   * tracking error it imposes. At a flat 0.3 mrad per m/s that trade never paid
   * for anyone, so every mech stood still, every silhouette sat on the
   * saturated end of the erf, and the light chassis had no identity.
   */
  moveJitterMult?: number;
}

export interface PlacedPart {
  /** Unique instance id (a chassis can have multiple of the same part id). */
  instanceId: string;
  partId: string;
  origin: CellRef;
  rotation: Rotation;
  /** 0-1, salvage integrity. 1.0 = pristine. See docs/04 §3. */
  integrity: number;
  /** Modifier ids (quirks/mods, docs/04 §4-§4b) riding this instance forever. */
  modifiers?: string[];
  /** Variant multipliers on catalog stats (docs/04 §4), e.g. { damage: 1.08 }. */
  variant?: Partial<Record<'damage' | 'cycleS' | 'dispersionMrad' | 'hp', number>>;
}

export interface RouteCell extends CellRef {
  kind: RouteKind;
}

export interface Build {
  chassisId: string;
  parts: PlacedPart[];
  /** Free workshop infrastructure. Bus and heat-pipe routes may share a cell. */
  routes?: RouteCell[];
  /** Persistent global body condition, 0..1. Omitted means pristine. */
  chassisIntegrity?: number;
  /** Ordered highest-to-lowest; brownout sheds from the end first. See docs/02 §2. */
  powerPriority: string[];
}
