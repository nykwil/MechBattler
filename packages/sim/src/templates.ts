/**
 * Canonical template builds for the balance harness (docs/05 R4) and enemy
 * rosters. Every layout is hand-placed on the real chassis masks and
 * validated by test/templates.test.ts (placement legality + full power
 * connectivity), so harness results reflect build quality, not layout bugs.
 */
import type { Build, PlacedPart } from './types.js';
import { CORE_INSTANCE_ID } from './thermal.js';

export interface TemplateDef {
  id: string;
  name: string;
  /** One-line archetype description (doubles as intel-card blurb). */
  blurb: string;
  build: Build;
}

function part(instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation, integrity: 1 };
}

function regionalPart(
  instanceId: string,
  partId: string,
  regionId: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270 = 0,
): PlacedPart {
  return { instanceId, partId, origin: { regionId, x, y }, rotation, integrity: 1 };
}

/** Spatial-system teaching build: ports, routes, a full turret stack, and redundancy. */
export function muleSpatialDemo(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'body', 0, 3),
    regionalPart('turret', 'U-TUR', 'left-shoulder', 1, 0),
    regionalPart('mg', 'W-MG', 'left-shoulder', 1, 0),
    regionalPart('shell', 'U-SHELL', 'left-shoulder', 1, 0),
    regionalPart('carbine', 'W-CB', 'right-shoulder', 3, 0),
    regionalPart('sink', 'U-HS', 'right-shoulder', 5, 1),
  ];
  return {
    chassisId: 'CH-5',
    parts,
    routes: [
      { kind: 'wire', regionId: 'body', x: 0, y: 2 },
      { kind: 'wire', regionId: 'body', x: 1, y: 2 },
      { kind: 'wire', regionId: 'left-shoulder', x: 2, y: 1 },
      { kind: 'wire', regionId: 'body', x: 2, y: 3 },
      { kind: 'wire', regionId: 'body', x: 3, y: 2 },
      { kind: 'wire', regionId: 'body', x: 4, y: 2 },
      { kind: 'wire', regionId: 'right-shoulder', x: 3, y: 1 },
      { kind: 'wire', regionId: 'right-shoulder', x: 4, y: 1 },
      // Bus and heat pipe share these cells without consuming equipment space.
      { kind: 'coolant', regionId: 'body', x: 0, y: 2 },
      { kind: 'coolant', regionId: 'body', x: 1, y: 2 },
      { kind: 'coolant', regionId: 'left-shoulder', x: 2, y: 1 },
      { kind: 'coolant', regionId: 'body', x: 4, y: 2 },
      { kind: 'coolant', regionId: 'right-shoulder', x: 3, y: 1 },
      { kind: 'coolant', regionId: 'right-shoulder', x: 4, y: 1 },
    ],
    chassisIntegrity: 1,
    powerPriority: [CORE_INSTANCE_ID, 'carbine', 'turret', 'mg'],
  };
}

/**
 * CH-2 Vulture starter, kernel retuned Jul 2026 (docs/07): the original
 * twin-MG loadout forced a 16-cell scout to cross 60+ m of fire to reach its
 * 30-90 m band — HARD vs nearly everything in the adaptation sweep. Its
 * identity weapon is now the carbine (60-180 m: fight at range, speed as
 * defense) with one MG as close-in teeth. The Build Week tuning pass removed
 * one armor plate after the harness measured a 76% overall win rate: the
 * scout keeps its hybrid identity but pays for losing its range advantage.
 */
function vultureSkirmisher(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-E25', 3, 1),
    part('con1', 'U-CON', 2, 2),
    part('con2', 'U-CON', 1, 2),
    part('cb', 'W-CB', 0, 1, 90), // (0,1),(0,2)
    part('mg', 'W-MG', 2, 0), // (2,0),(3,0)
    part('rad', 'U-RAD', 1, 3), // (1,3),(2,3),(3,3)
    part('arm1', 'U-ARM', 1, 0),
  ];
  return { chassisId: 'CH-2', parts, powerPriority: [CORE_INSTANCE_ID, 'cb', 'mg'] };
}

/** CH-5 Mule starter (docs/04 §6 "Mule gunline"): the tutorial-shaped build. */
function muleGunline(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-C40', 3, 1),
    part('ac', 'W-AC', 1, 3),
    part('con1', 'U-CON', 3, 3),
    part('rad', 'U-RAD', 1, 0),
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac'] };
}

/**
 * CH-5 twin-MG brawler: cheap sustained fire, electric and cool. The final
 * Build Week fitting pass added front-row plating after fixed-seed battle
 * telemetry showed range access -- not heat or power -- was the generalist's
 * failure: it lost both MGs before closing against longer-ranged builds.
 * Keeping the twin-MG keystone preserves its brawler identity; the cheap
 * plates are the fitting-only recovery that docs/05 R10 calls for.
 */
function muleSkirmisher(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-E25', 3, 1),
    part('mg1', 'W-MG', 1, 1),
    part('con1', 'U-CON', 3, 3),
    part('con2', 'U-CON', 2, 3),
    part('mg2', 'W-MG', 1, 3, 90), // (1,3),(1,4)
    part('arm1', 'U-ARM', 2, 0),
    part('arm2', 'U-ARM', 3, 0),
    part('arm3', 'U-ARM', 1, 0),
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'] };
}

/**
 * CH-5 laser platform (docs/04 §6 "Mule tinkerer" grown up): hybrid reactors,
 * pipe-to-radiator highway. Second laser added Jul 2026 — one 9-dps gun on an
 * 11-budget hull could not carry a build (0% in every harness run); the
 * kernel is twin lasers time-sharing the hybrid supply.
 */
function muleLaserBoat(): Build {
  const parts: PlacedPart[] = [
    part('reactorE', 'R-E25', 0, 1), // (0,1),(1,1),(0,2),(1,2)
    part('reactorC', 'R-C40', 3, 1), // (3,1),(4,1),(3,2),(4,2)
    // Bridge conduit: without it the two reactors are independent networks
    // (docs/01 §3) and one laser starves on the 25 kW Whisper alone -- found
    // the hard way when the harness showed las1 permanently browned out.
    part('bridge', 'U-CON', 2, 1),
    part('las1', 'W-LAS', 1, 3), // (1,3),(2,3),(3,3)
    part('las2', 'W-LAS', 2, 0), // (2,0),(3,0),(4,0) -> (3,0) touches reactorC
    part('pipe', 'U-PIPE', 2, 4),
    part('rad', 'U-RAD', 1, 5), // (1,5),(2,5),(3,5)
    part('arm1', 'U-ARM', 0, 3),
  ];
  // Stop-and-pop doctrine (docs/02 §2): guns above locomotion, so the boat
  // plants itself to keep both lasers charged instead of browning one out.
  return { chassisId: 'CH-5', parts, powerPriority: ['las1', 'las2', CORE_INSTANCE_ID] };
}

/** CH-5 railgun sniper — the docs/02 §4 worked example, filling the whole grid. */
function railgunMule(): Build {
  const parts: PlacedPart[] = [
    part('rg', 'W-RG', 3, 0), // (3..4, 0..4)
    part('reactor', 'R-C40', 0, 1), // (0..1, 1..2)
    part('conA', 'U-CON', 2, 1),
    part('conB', 'U-CON', 1, 3),
    part('conC', 'U-CON', 2, 3),
    part('cap1', 'P-CAP', 0, 3, 90), // (0,3),(0,4)
    part('cap2', 'P-CAP', 1, 4, 90), // (1,4),(1,5)
    part('cap3', 'P-CAP', 2, 4, 90), // (2,4),(2,5)
    part('cap4', 'P-CAP', 1, 0), // (1,0),(2,0)
    part('rad', 'U-RAD', 5, 1, 90), // (5,1),(5,2),(5,3)
    part('arm1', 'U-ARM', 5, 4),
    part('arm2', 'U-ARM', 3, 5),
    part('arm3', 'U-ARM', 4, 5),
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'rg'] };
}

/** CH-7 Widow: orbits while facing (docs/03 §7) — the tracking-lag stress test. */
function widowOrbiter(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-E25', 4, 1), // (4,1),(5,1),(4,2),(5,2)
    part('con1', 'U-CON', 4, 3),
    part('mg1', 'W-MG', 2, 1), // (2,1),(3,1)
    // Build Week tuning pass: a carbine gives the orbiting chassis a way to
    // establish its game plan before entering the MG band, replacing rather
    // than stacking with the second MG. The baseline harness exposed a 24%
    // overall win rate and repeated 0-100 matchups.
    part('cb', 'W-CB', 2, 4),
    part('con2', 'U-CON', 4, 4),
    part('arm1', 'U-ARM', 3, 0),
    part('arm2', 'U-ARM', 2, 5),
  ];
  return { chassisId: 'CH-7', parts, powerPriority: [CORE_INSTANCE_ID, 'cb', 'mg1'] };
}

/**
 * CH-2 carbine sniper: fast, fragile, kites at long range with a light
 * precision gun. Relies on the ram-air cooling + speed-as-defense synergies.
 * On a bounded arena (docs/03 §1) it cannot kite forever -- its test is
 * whether it can whittle the enemy down before being cornered.
 */
function vultureSniper(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-E25', 3, 1), // (3,1),(4,1),(3,2),(4,2)
    part('cb', 'W-CB', 1, 2), // (1,2),(2,2) -> (2,2) touches reactor (3,2)
    part('rad', 'U-RAD', 1, 0), // (1,0),(2,0),(3,0)
    part('arm1', 'U-ARM', 0, 1),
    part('arm2', 'U-ARM', 1, 1),
    part('arm3', 'U-ARM', 0, 2),
  ];
  return { chassisId: 'CH-2', parts, powerPriority: [CORE_INSTANCE_ID, 'cb'] };
}

/**
 * CH-9 Bastion siege tank: slow, heavily armored, deletes at close range with
 * the Maul. Its win condition is surviving the crossing (armor onion +
 * mass-stagger immunity: only railgun-class hits stagger 12 t) then reaching
 * the enemy. The counter to a runaway sniper -- with the arena walls doing the
 * cornering. Adding/removing the front-armor plates is the build lever that
 * flips its sniper matchup (see scripts/tank-vs-sniper.ts).
 */
function bastionTank(): Build {
  const parts: PlacedPart[] = [
    part('reactor', 'R-C90', 3, 4), // (3-5, 4-6)
    part('br', 'W-BR', 1, 4), // (1-2, 4-6) -> (2,4) touches reactor (3,4)
    part('radBottom', 'U-RAD', 2, 8), // (2,3,4 @ y8) perimeter
    part('radLeft', 'U-RAD', 0, 2, 90), // (0, 2-4) perimeter
    part('hs1', 'U-HS', 6, 4),
    part('hs2', 'U-HS', 6, 5),
    part('hs3', 'U-HS', 6, 6),
    // Front armor onion (rows 0-1) + flank plates.
    part('a00', 'U-ARM', 2, 0), part('a01', 'U-ARM', 3, 0),
    part('a02', 'U-ARM', 4, 0), part('a03', 'U-ARM', 5, 0),
    part('a10', 'U-ARM', 1, 1), part('a11', 'U-ARM', 2, 1),
    part('a12', 'U-ARM', 3, 1), part('a13', 'U-ARM', 4, 1),
    part('a14', 'U-ARM', 5, 1), part('a15', 'U-ARM', 6, 1),
    part('a20', 'U-ARM', 1, 2), part('a21', 'U-ARM', 2, 2),
    part('a22', 'U-ARM', 6, 2), part('a23', 'U-ARM', 7, 2),
    part('a30', 'U-ARM', 7, 3), part('a31', 'U-ARM', 7, 4),
  ];
  return { chassisId: 'CH-9', parts, powerPriority: [CORE_INSTANCE_ID, 'br'] };
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast scout: carbine at range, MG up close.', build: vultureSkirmisher() },
  { id: 'mule-gunline', name: 'Mule Gunline', blurb: 'Autocannon on a combustion plant; wants a firing line.', build: muleGunline() },
  { id: 'mule-skirmisher', name: 'Mule Skirmisher', blurb: 'Twin-MG brawler, cheap sustained fire.', build: muleSkirmisher() },
  { id: 'mule-laser-boat', name: 'Mule Laser Boat', blurb: 'Hybrid reactors, heat-pipe highway to one radiator.', build: muleLaserBoat() },
  { id: 'railgun-mule', name: 'Railgun Mule', blurb: 'The docs/02 §4 worked example: cap-fed alpha strikes.', build: railgunMule() },
  { id: 'widow-orbiter', name: 'Widow Orbiter', blurb: 'Spider that orbits inside its band; hard to track.', build: widowOrbiter() },
  { id: 'vulture-sniper', name: 'Vulture Sniper', blurb: 'Fast carbine kiter; ram-air cooled, fragile.', build: vultureSniper() },
  { id: 'bastion-tank', name: 'Bastion Tank', blurb: 'Slow armored siege gun; stable, deletes up close.', build: bastionTank() },
];

/** Factory teaching blueprint, kept outside the canonical balance cohort. */
export const SPATIAL_DEMO_TEMPLATE: TemplateDef = {
  id: 'mule-spatial-demo',
  name: 'Mule Spatial Rig',
  blurb: 'Three regions, routed ports, armoured turret, and a fragile pod chain.',
  build: muleSpatialDemo(),
};
