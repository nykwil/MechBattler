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
  },
  'U-HS': {
    id: 'U-HS', name: 'Brick (heat sink)', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 60, hp: 20, tier: 1, thermalMassPerCell: 6.0,
    spatial: { transfersHeat: true, thermalConductance: 2 },
  },
  'U-ARM': {
    id: 'U-ARM', name: 'Plate (armor)', category: 'structural',
    shape: [{ dx: 0, dy: 0 }], massKg: 150, hp: 60, tier: 1,
  },
  'U-AMMO': {
    id: 'U-AMMO', name: 'Bin (ammo store)', category: 'utility',
    shape: line(2), massKg: 200, hp: 30, tier: 1,
  },
  'U-TC1': {
    id: 'U-TC1', name: 'Abacus (targeting computer)', category: 'utility',
    shape: [{ dx: 0, dy: 0 }], massKg: 50, hp: 15, tier: 2,
    draw: { continuousKw: 3 },
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
    },
  },
  'U-SHELL': {
    id: 'U-SHELL', name: 'Carapace (sealed shell)', category: 'structural',
    shape: line(2), massKg: 180, hp: 60, tier: 2,
    spatial: {
      layer: 'armour',
      stacksOn: ['payload'],
      coveredHeatMultiplier: 1.25,
      blocksPassiveCooling: true,
    },
  },

  // --- Power (docs/02 §2) ---
  'R-C40': {
    id: 'R-C40', name: 'Lump (combustion S)', category: 'reactor',
    shape: rect(2, 2), massKg: 350, hp: 50, tier: 1, thermalMassPerCell: 2.0,
    reactor: { archetype: 'combustion', outputKw: 40, wasteHeatKw: [3, 6], throttleLagS: 2.0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true },
  },
  'R-C90': {
    id: 'R-C90', name: 'Furnace (combustion M)', category: 'reactor',
    shape: rect(3, 3), massKg: 900, hp: 90, tier: 3, thermalMassPerCell: 2.0,
    reactor: { archetype: 'combustion', outputKw: 90, wasteHeatKw: [7, 15], throttleLagS: 3.0 },
    spatial: { transfersPower: true, electricalCapacityKw: 90, transfersHeat: true },
  },
  'R-E25': {
    id: 'R-E25', name: 'Whisper (electric S)', category: 'reactor',
    shape: rect(2, 2), massKg: 300, hp: 45, tier: 1, thermalMassPerCell: 2.0,
    reactor: { archetype: 'electric', outputKw: 25, wasteHeatKw: 1, throttleLagS: 0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true },
  },
  'R-E60': {
    id: 'R-E60', name: 'Arc (electric M)', category: 'reactor',
    shape: rect(3, 3), massKg: 750, hp: 80, tier: 3, thermalMassPerCell: 2.0,
    reactor: { archetype: 'electric', outputKw: 60, wasteHeatKw: 3, throttleLagS: 0 },
    spatial: { transfersPower: true, electricalCapacityKw: 60, transfersHeat: true },
  },
  'P-CAP': {
    id: 'P-CAP', name: 'Jolt (capacitor)', category: 'capacitor',
    shape: line(2), massKg: 90, hp: 20, tier: 2,
    capacitor: { storedKj: 60, chargeKw: 20, dischargeKw: 80 },
    spatial: { transfersPower: true, electricalCapacityKw: 60 },
  },
  // The heavy sibling to the Jolt: over 3× the reserve (nearly a full railgun
  // shot banked) but slow to fill and slow to dump. A big-alpha reservoir vs the
  // Jolt's small-and-snappy buffer — the choice cap-fed builds never had.
  'P-CAP2': {
    id: 'P-CAP2', name: 'Reservoir (capacitor L)', category: 'capacitor',
    shape: rect(2, 2), massKg: 320, hp: 35, tier: 3,
    capacitor: { storedKj: 200, chargeKw: 25, dischargeKw: 60 },
    spatial: { transfersPower: true, electricalCapacityKw: 60 },
  },

  // --- Weapons (docs/03 §5, power draw docs/02 §2) ---
  'W-MG': {
    id: 'W-MG', name: 'Stitcher (machine gun)', category: 'weapon',
    shape: line(2), massKg: 120, hp: 25, tier: 1,
    draw: { continuousKw: 2 },
    heat: { heatPerShotKj: 0.4 },
    weapon: {
      damage: 1.5, cycleS: 0.1, projectileSpeed: 800, dispersionMrad: 8.0,
      falloff: { rangeStart: 30, rangeEnd: 90, multAtEnd: 0.4 }, mountArcDeg: 90,
    },
    spatial: { layer: 'payload', stacksOn: ['support'] },
  },
  'W-AC': {
    id: 'W-AC', name: 'Judge (autocannon)', category: 'weapon',
    shape: rect(2, 3), massKg: 500, hp: 45, tier: 2,
    draw: { continuousKw: 6 },
    heat: { heatPerShotKj: 3 },
    weapon: {
      damage: 11.5, cycleS: 0.75, projectileSpeed: 600, dispersionMrad: 4.0,
      falloff: { rangeStart: 50, rangeEnd: 150, multAtEnd: 0.5 }, mountArcDeg: 60,
      recoilKnS: 0.4,
    },
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
      damage: 20, cycleS: 2.0, projectileSpeed: 'hitscan', dispersionMrad: 1.5,
      falloff: { rangeStart: 60, rangeEnd: 140, multAtEnd: 0.5 }, mountArcDeg: 70,
    },
  },
  'W-RKT': {
    id: 'W-RKT', name: 'Pepperbox (rocket pod)', category: 'weapon',
    shape: rect(2, 2), massKg: 260, hp: 35, tier: 2,
    draw: { continuousKw: 1 },
    heat: { heatPerShotKj: 2 },
    weapon: {
      damage: 6, salvoCount: 6, cycleS: 15, projectileSpeed: 250, dispersionMrad: 20.0,
      falloff: { rangeStart: 40, rangeEnd: 120, multAtEnd: 0.6, rangeMin: 30, multAtMin: 0.35 }, mountArcDeg: 120,
    },
  },
  'W-RG': {
    id: 'W-RG', name: 'Longshot (railgun)', category: 'weapon',
    shape: rect(2, 5), massKg: 1400, hp: 70, tier: 4,
    draw: { capFedEnergyPerShotKj: 220 },
    heat: { heatPerShotKj: 25 },
    weapon: {
      damage: 85, cycleS: 5, projectileSpeed: 2000, dispersionMrad: 1.2,
      falloff: { rangeStart: 80, rangeEnd: 240, multAtEnd: 0.85, rangeMin: 50, multAtMin: 0.3 }, mountArcDeg: 30,
      recoilKnS: 8,
    },
  },
  // Light precision carbine: the fast-scout sniper enabler. Long band, tight
  // dispersion, low mass -- a Vulture can kite with it -- but modest DPS and a
  // real power draw, so it is a positioning weapon, not an alpha strike.
  'W-CB': {
    id: 'W-CB', name: 'Needle (carbine)', category: 'weapon',
    shape: line(2), massKg: 180, hp: 20, tier: 2,
    draw: { continuousKw: 4 },
    heat: { heatPerShotKj: 0.8 },
    weapon: {
      damage: 8, cycleS: 0.6, projectileSpeed: 900, dispersionMrad: 2.0,
      falloff: { rangeStart: 60, rangeEnd: 180, multAtEnd: 0.6 }, mountArcDeg: 50,
      recoilKnS: 0.2,
    },
  },
  // Heavy short-range brute: the tank's payoff weapon. Enormous close damage
  // that falls off a cliff past 45 m, heavy, slow projectile, big power/heat
  // bill and recoil -- useless at sniper range, deletes things once the tank
  // survives the crossing. A slow chassis's reason to wade in.
  'W-BR': {
    id: 'W-BR', name: 'Maul (siege gun)', category: 'weapon',
    shape: rect(2, 3), massKg: 650, hp: 50, tier: 3,
    draw: { continuousKw: 8 },
    heat: { heatPerShotKj: 6 },
    weapon: {
      damage: 40, cycleS: 2.0, projectileSpeed: 400, dispersionMrad: 6.0,
      falloff: { rangeStart: 15, rangeEnd: 45, multAtEnd: 0.2 }, mountArcDeg: 45,
      recoilKnS: 2,
    },
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
    draw: { continuousKw: 5 },
    heat: { heatPerShotKj: 3 },
    weapon: {
      damage: 3, cycleS: 0.4, projectileSpeed: 'hitscan', dispersionMrad: 3.0,
      falloff: { rangeStart: 20, rangeEnd: 45, multAtEnd: 0.2 }, mountArcDeg: 90,
      enemyHeatKj: 6,
    },
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
      damage: 5, cycleS: 1.4, projectileSpeed: 'hitscan', dispersionMrad: 1.8,
      falloff: { rangeStart: 50, rangeEnd: 150, multAtEnd: 0.5 }, mountArcDeg: 60,
      capDrainKj: 25,
    },
  },
};

export function getPart(id: string): PartDef {
  const part = PARTS[id];
  if (!part) throw new Error(`Unknown part id: ${id}`);
  return part;
}
