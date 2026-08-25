/**
 * Canonical part catalog. Numbers are transcribed from:
 *  - docs/01-chassis-grid-spec.md §7 (shape, mass, HP, tier)
 *  - docs/02-power-heat-spec.md §2-3 (power, heat)
 *  - docs/03-combat-spec.md §5 (ballistics)
 */
import type { CellOffset, PartDef } from './types.js';

function line(n: number): CellOffset[] {
  return Array.from({ length: n }, (_, i) => ({ dx: i, dy: 0 }));
}

function rect(w: number, h: number): CellOffset[] {
  const cells: CellOffset[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ dx: x, dy: y });
  return cells;
}

export const PARTS: Record<string, PartDef> = {
  // --- Structural / utility (docs/01 §7) ---
  'U-CON': {
    id: 'U-CON', name: 'Power coupler', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 15, hp: 10, tier: 1, isConduit: true,
    spatial: { layer: 'payload', transfersPower: true, electricalCapacityKw: 60 },
  },
  'U-PIPE': {
    id: 'U-PIPE', name: 'Thermal manifold', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 20, hp: 10, tier: 1, isHeatPipe: true,
    spatial: { layer: 'payload', transfersHeat: true, thermalConductance: 4 },
  },
  'U-RAD': {
    id: 'U-RAD', name: 'Gill (radiator)', category: 'utility',
    shape: line(3), massKg: 100, hp: 25, tier: 2, perimeterOnly: true,
    spatial: { transfersHeat: true, thermalConductance: 2 },
  },
  'U-HS': {
    id: 'U-HS', name: 'Brick (heat sink)', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 60, hp: 20, tier: 1, thermalMassPerCell: 6.0,
    spatial: { transfersHeat: true, thermalConductance: 2 },
  },
  'U-ARM': {
    id: 'U-ARM', name: 'Plate (armor)', category: 'structural',
    shape: [{ dx: 0, dy: 0 }], massKg: 150, hp: 60, tier: 1,
    spatial: { height: 0 },
  },
  'U-AMMO': {
    id: 'U-AMMO', name: 'Bin (ammo store)', category: 'utility',
    shape: line(2), massKg: 200, hp: 30, tier: 1,
  },
  'U-TC1': {
    id: 'U-TC1', name: 'Abacus (targeting computer)', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 50, hp: 15, tier: 2,
    draw: { continuousKw: 3 },
    // Fire control against a crossing target. Multiplicative, so a second
    // computer compounds -- three cells and 9 kW is the price of nearly
    // perfect leading, and the cost is what limits it rather than a cap.
    fireControlLateralMult: 0.4,
  },
  'U-ACT': {
    id: 'U-ACT', name: 'Stride (servo booster)', category: 'utility',
    shape: line(2), massKg: 160, hp: 25, tier: 2,
    draw: { continuousKw: 4 },
    // One powered booster improves all translation speeds by 15%. Multiple
    // copies add redundancy, not multiplicative speed (diversity guardrail).
    speedMult: 1.15,
  },
  'U-TUR': {
    id: 'U-TUR', name: 'Gimbal (turret support)', category: 'utility',
    shape: line(2), massKg: 90, hp: 30, tier: 2,
    draw: { continuousKw: 2 },
    spatial: {
      layer: 'support',
      transfersPower: true,
      electricalCapacityKw: 60,
      transfersHeat: true,
      thermalConductance: 1.5,
      weaponArcBonusDeg: 25,
      height: 1,
      stacksOn: ['support'],
    },
  },
  // Risers carry transfersHeat, so their cells are thermal edges for whatever
  // sits on top -- destroy a 20 HP riser and the gun standing on it loses its
  // heat path along with its support.
  'U-RISE2': {
    id: 'U-RISE2', name: 'Block (riser)', category: 'structural',
    shape: rect(2, 2), massKg: 60, hp: 20, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, electricalCapacityKw: 60, transfersHeat: true },
  },
  'U-RISE3': {
    id: 'U-RISE3', name: 'Pylon (riser)', category: 'structural',
    shape: rect(2, 3), massKg: 90, hp: 25, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, electricalCapacityKw: 60, transfersHeat: true },
  },
  'U-RISEL': {
    id: 'U-RISEL', name: 'Beam (riser)', category: 'structural',
    shape: line(3), massKg: 70, hp: 20, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, electricalCapacityKw: 60, transfersHeat: true },
  },
  'U-SHELL': {
    id: 'U-SHELL', name: 'Carapace (sealed shell)', category: 'structural',
    shape: line(2), massKg: 180, hp: 60, tier: 2,
    spatial: {
      layer: 'armour',
      stacksOn: ['payload'],
      coveredHeatMultiplier: 1.25,
      blocksPassiveCooling: true,
      height: 0,
    },
  },

  // --- Power (docs/02 §2) ---
  'R-C40': {
    id: 'R-C40', name: 'Lump (combustion S)', category: 'reactor',
    shape: rect(2, 2), massKg: 350, hp: 50, tier: 1, thermalMassPerCell: 2.0,
    reactor: { archetype: 'combustion', outputKw: 40, wasteHeatKw: [3, 6], throttleLagS: 2.0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, height: 2 },
  },
  'R-C90': {
    id: 'R-C90', name: 'Furnace (combustion M)', category: 'reactor',
    shape: rect(3, 3), massKg: 900, hp: 90, tier: 3, thermalMassPerCell: 2.0,
    reactor: { archetype: 'combustion', outputKw: 90, wasteHeatKw: [7, 15], throttleLagS: 3.0 },
    spatial: { transfersPower: true, electricalCapacityKw: 90, transfersHeat: true, height: 2 },
  },
  'R-E25': {
    id: 'R-E25', name: 'Whisper (electric S)', category: 'reactor',
    shape: rect(2, 2), massKg: 300, hp: 45, tier: 1, thermalMassPerCell: 2.0,
    reactor: { archetype: 'electric', outputKw: 25, wasteHeatKw: 1, throttleLagS: 0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, height: 2 },
  },
  'R-E60': {
    id: 'R-E60', name: 'Arc (electric M)', category: 'reactor',
    shape: rect(3, 3), massKg: 750, hp: 80, tier: 3, thermalMassPerCell: 2.0,
    reactor: { archetype: 'electric', outputKw: 60, wasteHeatKw: 3, throttleLagS: 0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, height: 2 },
  },
  'P-CAP': {
    id: 'P-CAP', name: 'Jolt (capacitor)', category: 'capacitor',
    shape: line(2), massKg: 90, hp: 20, tier: 2,
    capacitor: { storedKj: 60, chargeKw: 20, dischargeKw: 80 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, height: 2 },
  },
  // The heavy sibling to the Jolt: over 3× the reserve (nearly a full railgun
  // shot banked) but slow to fill and slow to dump. A big-alpha reservoir vs the
  // Jolt's small-and-snappy buffer — the choice cap-fed builds never had.
  'P-CAP2': {
    id: 'P-CAP2', name: 'Reservoir (capacitor L)', category: 'capacitor',
    shape: rect(2, 2), massKg: 320, hp: 35, tier: 3,
    capacitor: { storedKj: 200, chargeKw: 25, dischargeKw: 60 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, height: 2 },
  },

  // --- Weapons (docs/03 §5, power draw docs/02 §2) ---
  // Projectile speeds, Aug 2026. Every round crossed the arena inside a frame or
  // two, which was wrong twice over: nothing looked like it was travelling, and
  // time of flight is a *term in the hit model* -- sigma combines dispersion with
  // the target's crossing speed times (tracking lag + ToF). At 800 m/s the ToF
  // term was rounding error next to the 0.2-0.35 s tracking lag, so shooting a
  // moving target cost almost nothing and essentially every shot connected.
  // Roughly quartering them makes lead error real against a crosser while leaving
  // a standing target as easy as it ever was -- which is the tradeoff that was
  // supposed to exist. The railgun keeps its place as the flattest-shooting gun
  // in the catalog; hitscan weapons (laser, flamer, ion) are unaffected by
  // construction, which is now a reason to bring one.
  //
  //
  // Minimum ranges: four bands — empty under min, fade up to idealMin, solid
  // through idealMax, fade to ×0 at max. The Stitcher floors at 10 with a
  // 10–40 m sweet spot so it is still the close gun without hugging contact.
  // Siege and flamer keep idealMin at 0 (full at point blank).
  'W-MG': {
    id: 'W-MG', name: 'Stitcher (machine gun)', category: 'weapon',
    shape: line(2), massKg: 120, hp: 25, tier: 1,
    heat: { heatPerShotKj: 0.4 },
    weapon: {
      weaponClass: 'ballistic',
      damage: 1.5, cycleS: 0.1, projectileSpeed: 400, dispersionMrad: 8,
      falloff: { min: 10, idealMin: 10, idealMax: 40, max: 90 }, mountArcDeg: 90,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 1, clearsForward: 0 },
  },
  'W-AC': {
    id: 'W-AC', name: 'Judge (autocannon)', category: 'weapon',
    shape: rect(2, 3), massKg: 500, hp: 45, tier: 2,
    heat: { heatPerShotKj: 3 },
    weapon: {
      weaponClass: 'ballistic',
      damage: 11.5, cycleS: 0.75, projectileSpeed: 300, dispersionMrad: 4,
      falloff: { idealMin: 20, idealMax: 50, max: 150 }, mountArcDeg: 60,
      recoilKnS: 0.4,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 3, clearsForward: 1 },
  },
  // Retuned Jul 2026 (docs/07): the original laser was the worst
  // energy-per-dps and heat-per-dps in the catalog (45 kJ + 12 kJ heat per
  // 18 damage) and lost every harness matchup. The efficiency lever: 30 kJ
  // per shot at the same 30 kW charge rate -> 2.0 s cycle, 9.0 dps, heat
  // trimmed to 9 kJ, damage 18->20 (10 dps: the hitscan+precision premium
  // priced below the autocannon's raw dps). (An earlier
  // attempt raised the charge RATE instead; that
  // raised instantaneous demand past small reactors and the brownout rule
  // shed the gun entirely -- an energy buff that was a power-system nerf.)
  'W-LAS': {
    id: 'W-LAS', name: 'Ember (laser)', category: 'weapon',
    shape: line(3), massKg: 220, hp: 30, tier: 2,
    draw: { chargedEnergyPerShotKj: 30, minChargeS: 1.0, maxChargeKw: 30 },
    heat: { heatPerShotKj: 9 },
    weapon: {
      weaponClass: 'energy',
      damage: 19, cycleS: 2.0, projectileSpeed: 'hitscan', dispersionMrad: 1.5,
      falloff: { idealMin: 25, idealMax: 60, max: 140 }, mountArcDeg: 70,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 3, clearsForward: 1 },
  },
  'W-RKT': {
    id: 'W-RKT', name: 'Pepperbox (rocket pod)', category: 'weapon',
    shape: rect(2, 2), massKg: 260, hp: 35, tier: 2,
    heat: { heatPerShotKj: 2 },
    weapon: {
      weaponClass: 'missile',
      damage: 6, salvoCount: 6, cycleS: 15, projectileSpeed: 125, dispersionMrad: 20.0,
      falloff: { idealMin: 30, idealMax: 40, max: 120 }, mountArcDeg: 120,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 3, clearsForward: 1 },
  },
  'W-RG': {
    id: 'W-RG', name: 'Longshot (railgun)', category: 'weapon',
    shape: rect(2, 5), massKg: 1400, hp: 70, tier: 4,
    draw: { capFedEnergyPerShotKj: 220 },
    heat: { heatPerShotKj: 25 },
    weapon: {
      weaponClass: 'ballistic',
      damage: 85, cycleS: 5, projectileSpeed: 1000, dispersionMrad: 1.2,
      falloff: { idealMin: 50, idealMax: 80, max: 240 }, mountArcDeg: 30,
      recoilKnS: 8,
    },
    spatial: { layer: 'payload', height: 3, clearsForward: 1 },
  },
  // Light precision carbine: the fast-scout sniper enabler. Long band, tight
  // dispersion, low mass -- a Vulture can kite with it -- but modest DPS and a
  // real power draw, so it is a positioning weapon, not an alpha strike.
  'W-CB': {
    // Tier 2 -> 3, Aug 2026. At tier 2 the carbine was the longest-reaching gun
    // short of the tier-4 railgun and the most accurate one short of it, for
    // less power than the autocannon it out-ranges by 30 m. Nothing paid for
    // that: three of them behind two small reactors came to tier 13, fit inside
    // the 14-tier starting budget, and measured a 93% win rate across the
    // ladder — a dominant build available before the first fight. At tier 3 the
    // same fit costs 16 and has to be grown into instead. Dispersion was tried
    // at 3.0 as well and reverted: it did not change what the build cost, and
    // weakening every carbine user around the laser boat pushed that template
    // from 68% back over the 70% flag.
    id: 'W-CB', name: 'Needle (carbine)', category: 'weapon',
    shape: line(2), massKg: 180, hp: 20, tier: 3,
    heat: { heatPerShotKj: 0.8 },
    weapon: {
      weaponClass: 'ballistic',
      damage: 8, cycleS: 0.6, projectileSpeed: 450, dispersionMrad: 2,
      falloff: { idealMin: 35, idealMax: 60, max: 180 }, mountArcDeg: 50,
      recoilKnS: 0.2,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 1, clearsForward: 0 },
  },
  // Heavy short-range brute: the tank's payoff weapon. Enormous close damage
  // that falls off a cliff past 45 m, heavy, slow projectile, big power/heat
  // bill and recoil -- useless at sniper range, deletes things once the tank
  // survives the crossing. A slow chassis's reason to wade in.
  'W-BR': {
    id: 'W-BR', name: 'Maul (siege gun)', category: 'weapon',
    shape: rect(2, 3), massKg: 650, hp: 50, tier: 3,
    heat: { heatPerShotKj: 6 },
    weapon: {
      weaponClass: 'ballistic',
      damage: 40, cycleS: 2.0, projectileSpeed: 200, dispersionMrad: 6,
      falloff: { idealMin: 0, idealMax: 15, max: 45 }, mountArcDeg: 45,
      recoilKnS: 2,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 3, clearsForward: 1 },
  },
  // System-attacking weapons (docs/07 Track C §4): higher-tier tech that hits a
  // simulated system, not just HP. Legible on existing gauges (enemy heat on the
  // thermal overlay, enemy charge on the CAP gauge), so R4 holds with no new UI.
  //
  // Scald: a short-range flamer. Trivial HP damage, but each lick dumps heat
  // into the struck cell — overwhelms a build's cooling into shutdown/burn-down.
  // Runs the wielder hot too, and near-useless past bad breath range.
  'W-SC': {
    id: 'W-SC', name: 'Scald (flamer)', category: 'weapon',
    shape: rect(2, 2), massKg: 280, hp: 30, tier: 3,
    heat: { heatPerShotKj: 3 },
    weapon: {
      weaponClass: 'chemical',
      damage: 3, cycleS: 0.4, projectileSpeed: 'hitscan', dispersionMrad: 3,
      falloff: { idealMin: 0, idealMax: 20, max: 45 }, mountArcDeg: 90,
      enemyHeatKj: 6,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 1, clearsForward: 0 },
  },
  // Static: an ion cannon. Modest damage, but each hit bleeds the enemy's stored
  // capacitor charge — starves railgun alphas and Surge-gate/Thermocouple builds
  // of the reserve their identity depends on. A situational counter vs cap-light
  // foes; a build-wrecker vs cap-heavy ones.
  'W-ION': {
    id: 'W-ION', name: 'Static (ion cannon)', category: 'weapon',
    shape: line(3), massKg: 240, hp: 30, tier: 3,
    draw: { chargedEnergyPerShotKj: 25, minChargeS: 0.8, maxChargeKw: 30 },
    heat: { heatPerShotKj: 6 },
    weapon: {
      weaponClass: 'energy',
      damage: 5, cycleS: 1.4, projectileSpeed: 'hitscan', dispersionMrad: 1.8,
      falloff: { idealMin: 25, idealMax: 50, max: 150 }, mountArcDeg: 60,
      capDrainKj: 25,
    },
    spatial: { layer: 'payload', stacksOn: ['support'], height: 3, clearsForward: 1 },
  },
};

export function getPart(id: string): PartDef {
  const part = PARTS[id];
  if (!part) throw new Error(`Unknown part id: ${id}`);
  return part;
}

/**
 * True when a part must reach a reactor through the electrical net or the build
 * is invalid. Weapons and capacitors qualify by category because a gun fed only
 * from a capacitor (`capFedEnergyPerShotKj`) and the capacitor filling it both
 * need the net without necessarily declaring a continuous `draw`.
 *
 * This lived in three places and two of them disagreed. `validation.ts` and
 * `autowire.ts` shared this rule; `Plate.tsx` had its own, which tested only
 * `continuousKw || chargedEnergyPerShotKj || reactor`. Diffed across the
 * catalog, that silently excluded `W-RG` and both capacitors -- the workshop
 * never drew a disconnected railgun or capacitor as unpowered while validation
 * rejected the build, on the three highest-tier parts in the game.
 */
export function requiresPowerConnection(def: PartDef): boolean {
  return Boolean(def.draw) || def.category === 'weapon' || def.category === 'capacitor';
}

/**
 * True when connectivity is *meaningful* for a part, so an instrument should
 * colour it live/dead rather than dim it as not-applicable. A superset of
 * `requiresPowerConnection`: a reactor supplies the net instead of drawing from
 * it, and `resolveSpatialPower` does count sources in `connectedInstanceIds`,
 * so an isolated one is worth showing as unpowered even though no rule rejects it.
 */
/**
 * True when a part can ever compete for the power budget, and so belongs on
 * `build.powerPriority` where the player orders what gets shed first.
 *
 * Deliberately narrower than `requiresPowerConnection`. `Simulation` only ranks
 * instances that requested a positive draw this tick, and it computes that draw
 * from `continuousKw` or a weapon's `chargedEnergyPerShotKj` -- nothing else can
 * reach `requestedKw`. So a capacitor or a cap-fed railgun on the priority list
 * is an entry the player can drag up and down to no effect whatsoever.
 *
 * Three copies of this existed and one disagreed: `progression.ts` used
 * `draw || weapon`, which put W-RG on the AI's lists but not the player's. The
 * entry was inert either way, which is why nothing ever caught it.
 */
export function competesForPowerBudget(def: PartDef): boolean {
  return Boolean(def.draw?.continuousKw
    || (def.category === 'weapon' && def.draw?.chargedEnergyPerShotKj));
}

/**
 * True when this weapon's shot is not paid for out of the electrical bus, so it
 * keeps firing through a brownout, a shed bus, or a dead reactor.
 *
 * The class says what it consumes; the draw says whether it still needs the
 * bus anyway. `W-RG` is the one weapon where those disagree on purpose: it is
 * ballistic -- it throws a slug -- but it bought 1000 m/s of muzzle velocity by
 * taking a capacitor feed, so it dies with the reactor. That is the cost of the
 * hardest-hitting gun in the catalog, not an oversight.
 *
 * Mechanical firing does NOT mean unconstrained. These weapons still have to be
 * wired (fire control and the feed motor justify the connection even though the
 * shot does not draw), still stop when the part overheats, and still make heat.
 * What they stop caring about is who wins the power budget.
 */
export function firesMechanically(def: PartDef): boolean {
  if (!def.weapon || def.weapon.weaponClass === 'energy') return false;
  return !def.draw?.chargedEnergyPerShotKj && !def.draw?.capFedEnergyPerShotKj;
}

export function participatesInPowerNetwork(def: PartDef): boolean {
  return requiresPowerConnection(def) || Boolean(def.reactor);
}
