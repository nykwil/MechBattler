/**
 * Canonical template builds for the balance harness (docs/05 R4) and enemy
 * rosters. Every layout is hand-placed on the real chassis masks and
 * validated by test/templates.test.ts (placement legality + full power
 * connectivity), so harness results reflect build quality, not layout bugs.
 */
import type { Build, PlacedPart } from './types.js';
import { applyAutoWire } from './autowire.js';
import { getChassis } from './chassis.js';
import { CORE_INSTANCE_ID } from './thermal.js';

export interface TemplateDef {
  id: string;
  name: string;
  /** One-line archetype description (doubles as intel-card blurb). */
  blurb: string;
  build: Build;
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

/** Canonical authored fits always carry the same deterministic free routing as the workshop. */
function wired(build: Build): Build {
  return applyAutoWire(getChassis(build.chassisId), build).build;
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
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('cb', 'W-CB', 'left-hardpoint', 0, 1),
    regionalPart('mg', 'W-MG', 'left-hardpoint', 0, 2),
    regionalPart('sink', 'U-HS', 'body', 2, 3),
    regionalPart('arm1', 'U-ARM', 'body', 2, 0),
    regionalPart('arm2', 'U-ARM', 'right-hardpoint', 3, 0),
  ];
  return wired({ chassisId: 'CH-2', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'cb', 'mg'] });
}

/** CH-5 Mule starter (docs/04 §6 "Mule gunline"): the tutorial-shaped build. */
function muleGunline(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-C40', 'body', 3, 2),
    regionalPart('ac', 'W-AC', 'body', 1, 4, 90),
    regionalPart('con1', 'U-CON', 'body', 1, 2),
    regionalPart('rad', 'U-RAD', 'left-shoulder', 0, 1),
  ];
  return wired({ chassisId: 'CH-5', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'ac'] });
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
    regionalPart('reactor', 'R-E25', 'body', 3, 2),
    regionalPart('mg1', 'W-MG', 'left-shoulder', 1, 1),
    regionalPart('con1', 'U-CON', 'body', 1, 2),
    regionalPart('con2', 'U-CON', 'body', 1, 3),
    regionalPart('mg2', 'W-MG', 'body', 1, 4, 90),
    regionalPart('arm1', 'U-ARM', 'right-shoulder', 3, 0),
    regionalPart('arm2', 'U-ARM', 'right-shoulder', 4, 0),
    regionalPart('arm3', 'U-ARM', 'right-shoulder', 5, 1),
  ];
  return wired({ chassisId: 'CH-5', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'] });
}

/**
 * CH-5 laser platform (docs/04 §6 "Mule tinkerer" grown up): hybrid reactors,
 * pipe-to-radiator highway. Second laser added Jul 2026 — one 9-dps gun on an
 * 11-budget hull could not carry a build (0% in every harness run); the
 * kernel is twin lasers time-sharing the hybrid supply.
 */
function muleLaserBoat(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactorE', 'R-E25', 'body', 0, 3),
    regionalPart('reactorC', 'R-C40', 'body', 4, 3),
    // Ordinary touching equipment now forms the central electrical spine.
    regionalPart('bridge', 'U-CON', 'body', 2, 3),
    regionalPart('pipe', 'U-PIPE', 'body', 3, 3),
    regionalPart('las1', 'W-LAS', 'body', 1, 5),
    regionalPart('las2', 'W-LAS', 'body', 3, 2),
    regionalPart('rad', 'U-RAD', 'left-shoulder', 0, 1),
    regionalPart('arm1', 'U-ARM', 'right-shoulder', 5, 1),
  ];
  // Stop-and-pop doctrine (docs/02 §2): guns above locomotion, so the boat
  // plants itself to keep both lasers charged instead of browning one out.
  return wired({
    chassisId: 'CH-5', parts,
    routes: [{ kind: 'coolant', regionId: 'body', x: 1, y: 2 }],
    powerPriority: ['las1', 'las2', CORE_INSTANCE_ID],
  });
}

/** CH-5 railgun sniper — the docs/02 §4 worked example, filling the whole grid. */
function railgunMule(): Build {
  const parts: PlacedPart[] = [
    regionalPart('rg', 'W-RG', 'body', 0, 3, 90),
    regionalPart('reactor', 'R-C40', 'right-shoulder', 3, 0),
    regionalPart('conA', 'U-CON', 'left-shoulder', 1, 0),
    regionalPart('conB', 'U-CON', 'left-shoulder', 2, 0),
    regionalPart('conC', 'U-CON', 'body', 0, 2),
    regionalPart('cap1', 'P-CAP', 'body', 4, 2),
    regionalPart('cap2', 'P-CAP', 'body', 1, 5),
    regionalPart('cap3', 'P-CAP', 'body', 3, 5),
    regionalPart('cap4', 'P-CAP', 'body', 5, 3, 90),
    regionalPart('rad', 'U-RAD', 'left-shoulder', 0, 1),
    regionalPart('arm1', 'U-ARM', 'body', 1, 2),
    regionalPart('arm2', 'U-ARM', 'body', 3, 2),
    regionalPart('arm3', 'U-ARM', 'right-shoulder', 5, 1),
  ];
  return wired({ chassisId: 'CH-5', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'rg'] });
}

/**
 * CH-2 carbine sniper: fast, fragile, kites at long range with a light
 * precision gun. Relies on the ram-air cooling + speed-as-defense synergies.
 * On a bounded arena (docs/03 §1) it cannot kite forever -- its test is
 * whether it can whittle the enemy down before being cornered.
 */
function vultureSniper(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('cb', 'W-CB', 'left-hardpoint', 1, 0, 90),
    regionalPart('coldSink', 'U-HS', 'left-hardpoint', 0, 2),
    regionalPart('sink', 'U-HS', 'body', 2, 3),
    regionalPart('arm1', 'U-ARM', 'left-hardpoint', 0, 1),
    regionalPart('arm2', 'U-ARM', 'body', 2, 0),
    regionalPart('arm3', 'U-ARM', 'right-hardpoint', 3, 0),
  ];
  return wired({ chassisId: 'CH-2', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'cb'] });
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
    regionalPart('reactor', 'R-C90', 'hull', 3, 3),
    regionalPart('br', 'W-BR', 'left-sponson', 0, 2),
    regionalPart('radRight', 'U-RAD', 'right-sponson', 7, 2, 90),
    regionalPart('radBottom', 'U-RAD', 'hull', 2, 8),
    regionalPart('hs1', 'U-HS', 'hull', 2, 6),
    regionalPart('hs2', 'U-HS', 'hull', 3, 6),
    regionalPart('hs3', 'U-HS', 'hull', 4, 6),
    regionalPart('a00', 'U-ARM', 'hull', 2, 0),
    regionalPart('a01', 'U-ARM', 'hull', 3, 0),
    regionalPart('a02', 'U-ARM', 'hull', 4, 0),
    regionalPart('a03', 'U-ARM', 'hull', 5, 0),
    regionalPart('a10', 'U-ARM', 'left-sponson', 1, 1),
    regionalPart('a11', 'U-ARM', 'hull', 2, 1),
    regionalPart('a12', 'U-ARM', 'hull', 3, 1),
    regionalPart('a13', 'U-ARM', 'hull', 4, 1),
    regionalPart('a14', 'U-ARM', 'hull', 5, 1),
    regionalPart('a15', 'U-ARM', 'right-sponson', 6, 1),
  ];
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'br'] });
}

function vultureCloseScout(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('mg1', 'W-MG', 'left-hardpoint', 0, 1),
    regionalPart('mg2', 'W-MG', 'left-hardpoint', 0, 2),
    regionalPart('armBodyFront', 'U-ARM', 'body', 2, 0),
    regionalPart('armBodyRear', 'U-ARM', 'body', 2, 3),
    regionalPart('armRight', 'U-ARM', 'right-hardpoint', 3, 0),
  ];
  return wired({ chassisId: 'CH-2', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'] });
}

function bastionAutocannonCasemate(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-C40', 'hull', 3, 3),
    regionalPart('ac', 'W-AC', 'left-sponson', 0, 2),
    regionalPart('rad', 'U-RAD', 'right-sponson', 7, 2, 90),
    regionalPart('tc', 'U-TC1', 'hull', 5, 3),
    regionalPart('arm0', 'U-ARM', 'hull', 2, 0),
    regionalPart('arm1', 'U-ARM', 'hull', 3, 0),
    regionalPart('arm2', 'U-ARM', 'hull', 4, 0),
    regionalPart('arm3', 'U-ARM', 'hull', 5, 0),
  ];
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'tc', 'ac'] });
}

function bastionLaserBunker(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-C40', 'hull', 3, 3),
    regionalPart('laserFront', 'W-LAS', 'hull', 2, 0),
    regionalPart('laserRear', 'W-LAS', 'hull', 2, 7),
    regionalPart('radLeft', 'U-RAD', 'left-sponson', 0, 2, 90),
    regionalPart('radRight', 'U-RAD', 'right-sponson', 7, 2, 90),
    regionalPart('sink', 'U-HS', 'hull', 5, 7),
    regionalPart('arm0', 'U-ARM', 'hull', 2, 1),
    regionalPart('arm1', 'U-ARM', 'hull', 3, 1),
    regionalPart('arm2', 'U-ARM', 'hull', 4, 1),
  ];
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: ['laserFront', 'laserRear', CORE_INSTANCE_ID] });
}

function bastionSuppressionStride(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'hull', 3, 3),
    regionalPart('mgLeft', 'W-MG', 'left-sponson', 0, 2),
    regionalPart('mgRight', 'W-MG', 'right-sponson', 6, 2),
    regionalPart('act', 'U-ACT', 'hull', 3, 6),
    regionalPart('arm0', 'U-ARM', 'hull', 2, 0),
    regionalPart('arm1', 'U-ARM', 'hull', 3, 0),
    regionalPart('arm2', 'U-ARM', 'hull', 4, 0),
    regionalPart('arm3', 'U-ARM', 'hull', 5, 0),
    regionalPart('armLeft', 'U-ARM', 'left-sponson', 1, 5),
    regionalPart('armRight', 'U-ARM', 'right-sponson', 6, 5),
  ];
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'act', 'mgLeft', 'mgRight'] });
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast scout: carbine at range, MG up close.', build: vultureSkirmisher() },
  { id: 'mule-gunline', name: 'Mule Gunline', blurb: 'Autocannon on a combustion plant; wants a firing line.', build: muleGunline() },
  { id: 'mule-skirmisher', name: 'Mule Skirmisher', blurb: 'Twin-MG brawler, cheap sustained fire.', build: muleSkirmisher() },
  { id: 'mule-laser-boat', name: 'Mule Laser Boat', blurb: 'Hybrid reactors, heat-pipe highway to one radiator.', build: muleLaserBoat() },
  { id: 'railgun-mule', name: 'Railgun Mule', blurb: 'The docs/02 §4 worked example: cap-fed alpha strikes.', build: railgunMule() },
  { id: 'vulture-sniper', name: 'Vulture Sniper', blurb: 'Fast carbine kiter; ram-air cooled, fragile.', build: vultureSniper() },
  { id: 'bastion-tank', name: 'Bastion Tank', blurb: 'Slow armored siege gun; stable, deletes up close.', build: bastionTank() },
];

/** One-hour branch probes: three legal, materially different starts per active chassis. */
export const BRANCH_PROBE_TEMPLATES: TemplateDef[] = [
  { id: 'probe-vulture-range', name: 'Vulture Range Skirmisher', blurb: 'Long-sight carbine with close defense.', build: vultureSkirmisher() },
  { id: 'probe-vulture-cold', name: 'Vulture Cold-bore Sniper', blurb: 'Overcooled precision opening.', build: vultureSniper() },
  { id: 'probe-vulture-close', name: 'Vulture Armored Scout', blurb: 'Twin-MG close scout with a protected body.', build: vultureCloseScout() },
  { id: 'probe-mule-gunline', name: 'Mule Autocannon Gunline', blurb: 'Combustion autocannon firing line.', build: muleGunline() },
  { id: 'probe-mule-thermal', name: 'Mule Laser Platform', blurb: 'Hybrid heat-managed laser platform.', build: muleLaserBoat() },
  { id: 'probe-mule-brawler', name: 'Mule Armored Brawler', blurb: 'Cheap sustained fire behind armor.', build: muleSkirmisher() },
  { id: 'probe-bastion-casemate', name: 'Bastion Autocannon Casemate', blurb: 'Protected, targeted sustained fire.', build: bastionAutocannonCasemate() },
  { id: 'probe-bastion-thermal', name: 'Bastion Laser Bunker', blurb: 'Casemate heat spreading and paired radiators.', build: bastionLaserBunker() },
  { id: 'probe-bastion-suppression', name: 'Bastion Suppression Stride', blurb: 'Armored twin-MG platform with powered mobility.', build: bastionSuppressionStride() },
];

/** Factory teaching blueprint, kept outside the canonical balance cohort. */
export const SPATIAL_DEMO_TEMPLATE: TemplateDef = {
  id: 'mule-spatial-demo',
  name: 'Mule Spatial Rig',
  blurb: 'Three regions, routed ports, armoured turret, and a fragile pod chain.',
  build: muleSpatialDemo(),
};
