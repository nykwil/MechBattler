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
    regionalPart('reactorC', 'R-E25', 'body', 4, 3),
    // Ordinary touching equipment now forms the central electrical spine.
    regionalPart('bridge', 'U-CON', 'body', 2, 3),
    regionalPart('pipe', 'U-PIPE', 'body', 3, 3),
    regionalPart('las1', 'W-LAS', 'body', 1, 5),
    regionalPart('las2', 'W-LAS', 'body', 3, 2),
    regionalPart('rad', 'U-RAD', 'left-shoulder', 0, 1),
  ];
  // Armor plate removed and the combustion half of the hybrid downgraded to a
  // second R-E25, Aug 2026 (docs/05 R4 targeted nerf at >70%). Hitscan pays only
  // tracking lag against a crossing target, while a ballistic gun also pays
  // time-of-flight — so once the autopilot learned to close on a slant, this
  // boat became the answer to everything and took the round robin to 80%.
  // The twin-laser keystone stays; it pays in plating and supply for being the
  // motion-tolerant gun in a game that now moves. 68% after.
  //
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
    // Targeting computer added Aug 2026. Once the autopilot could close on a
    // slant, every lighter frame crossed the siege gun's sightline and this
    // hull — the largest silhouette and the slowest strafe in the game — was
    // the only one that could neither evade nor lead, and fell from 55% to 13%
    // in the round robin. docs/03 §5 names the TC as *the* purchasable counter
    // to a crossing target (lag 0.3 s -> 0.1 s), so the frame that cannot dodge
    // is the frame that carries it. Power is untouched at +53 kW.
    regionalPart('tc', 'U-TC1', 'hull', 4, 2),
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
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'tc', 'br'] });
}

function vultureCloseScout(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('mg1', 'W-MG', 'left-hardpoint', 0, 1),
    regionalPart('mg2', 'W-MG', 'left-hardpoint', 0, 2),
    regionalPart('armBodyFront', 'U-ARM', 'body', 2, 0),
    regionalPart('armBodyRear', 'U-ARM', 'body', 2, 3),
    regionalPart('armRight', 'U-ARM', 'right-hardpoint', 3, 0),
    regionalPart('plate3', 'U-ARM', 'left-hardpoint', 1, 0),
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
    // Second plant added Aug 2026, same defect as the stride: twin lasers drew
    // 8.6 kW more than the combustion plant supplied, so the bunker shed a
    // laser mid-fight. Electric beside combustion also keeps the hybrid supply
    // this direction is supposed to be about.
    regionalPart('reactor2', 'R-E25', 'hull', 3, 5),
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
    // Second plant added Aug 2026. One R-E25 owed 29.8 kW to a powered
    // actuator and twin MGs and supplied 25, so the stride browned out and
    // shed the guns it exists to carry: 3% win rate across the ladder, and
    // Bastion supported none of its three intended directions.
    regionalPart('reactor2', 'R-E25', 'hull', 3, 7),
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

/**
 * Cheap ladder fodder, authored Aug 2026. The opening budget was lowered so a
 * fresh mech can actually win its first fights, but the cheapest template in
 * the pool cost tier 5 and was a Mule, so every opponent below that budget fell
 * back to the same frame: nodes 1 and 2 came out 93% CH-5. Since a chassis is
 * unlocked by beating an enemy flying it, and a fresh run averages a couple of
 * battles, that made the Vulture unreachable in practice.
 *
 * These are deliberately weak — one gun, one plate — because their job is to be
 * the bottom of the ladder, not to threaten. They exist so the bottom of the
 * ladder has more than one silhouette on it.
 */
function vultureScrapper(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('mg', 'W-MG', 'left-hardpoint', 0, 1),
    regionalPart('arm', 'U-ARM', 'body', 2, 0),
  ];
  return wired({ chassisId: 'CH-2', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'mg'] });
}

/**
 * The cheap Bastion. Its frame costs nothing in tier terms — the budget only
 * counts equipment — so an assault hull carrying one gun and one plate comes to
 * tier 4 and can sit at the bottom of the ladder beside the scrapper and the
 * runt. It is still 700 points of structure, which is why it rates threat 2
 * rather than fodder, and why beating one is a real errand rather than a
 * formality. That errand is the whole point: a chassis unlocks by defeating an
 * enemy flying it, and the Bastion probes cost tier 11-13, so before this the
 * cohort met a Bastion 3 times in 96 battles and CH-9 was unreachable.
 */
function bastionPicket(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'hull', 3, 3),
    regionalPart('mg1', 'W-MG', 'left-sponson', 0, 2),
    regionalPart('mg2', 'W-MG', 'right-sponson', 6, 2),
    regionalPart('arm', 'U-ARM', 'hull', 3, 0),
  ];
  return wired({ chassisId: 'CH-9', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'] });
}

function muleRunt(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'body', 3, 2),
    regionalPart('mg', 'W-MG', 'left-shoulder', 1, 1),
    regionalPart('arm', 'U-ARM', 'body', 1, 3),
  ];
  return wired({ chassisId: 'CH-5', parts, routes: [], powerPriority: [CORE_INSTANCE_ID, 'mg'] });
}

/**
 * The fresh player's first mech. Built only from the seven initial parts, at
 * tier 11 of the 14-tier starting budget so there is room to branch.
 *
 * Authored Aug 2026 to replace the twin-MG skirmisher as the *starting* fit
 * (that template stays in the ladder and the balance cohort unchanged). Two
 * things were measured into this layout:
 *
 * - Three weapons, not two. The dominant way a fresh run ended was not dying
 *   but being disarmed: a two-gun start loses both and mission-kills, and a
 *   20 hp carbine pair managed it in 10 of 20 opening fights. A third barrel
 *   makes the surrender condition much harder to reach — 2 disarms over the
 *   same sample.
 * - Mixed families. The carbine reaches 180 m and the pair of MGs carry the
 *   close band, so the mech is legal at any spawn the ladder offers and can
 *   branch either way: another carbine turns it into a reach build, another MG
 *   or plating into a brawler, and the spare 3 tier pays for either.
 *
 * Two guns sit in the shoulders for the Mule's articulated-shoulder arc bonus,
 * one in the body where it is harder to shoot off. Measured against the ladder
 * it opens at 0.95 / 0.85 / 0.70 / 0.85 over the first four nodes and decays to
 * a coin flip by node 9 — the run has to develop the build to go further.
 */
function muleNeedleSkirmisher(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'body', 3, 2),
    regionalPart('cb', 'W-CB', 'left-shoulder', 1, 1),
    regionalPart('mg1', 'W-MG', 'right-shoulder', 3, 1),
    regionalPart('mg2', 'W-MG', 'body', 1, 4),
    regionalPart('rad', 'U-RAD', 'body', 0, 2, 90),
    regionalPart('arm1', 'U-ARM', 'body', 1, 3),
    regionalPart('arm2', 'U-ARM', 'body', 2, 3),
    regionalPart('arm3', 'U-ARM', 'right-shoulder', 5, 1),
  ];
  return wired({
    chassisId: 'CH-5', parts, routes: [],
    powerPriority: [CORE_INSTANCE_ID, 'cb', 'mg1', 'mg2'],
  });
}

/** Starting fits offered on the front door. Not part of the balance cohort. */
export const STARTER_TEMPLATES: TemplateDef[] = [
  {
    id: 'mule-needle', name: 'Mule Needle Skirmisher',
    blurb: 'Three barrels, mixed reach: hard to disarm, and it can grow either way.',
    build: muleNeedleSkirmisher(),
  },
];

/**
 * Adds equipment to an authored fit and re-wires it. The branch probes used to
 * *be* the balance-cohort builds — `probe-mule-brawler` was literally
 * `muleSkirmisher()` — so bringing a probe up to budget silently moved the
 * canonical cohort with it. They are their own fits now, grown from the same
 * kernels so the identities still read the same.
 */
function withExtraParts(build: Build, extra: PlacedPart[], powered: string[] = []): Build {
  return applyAutoWire(getChassis(build.chassisId), {
    ...build,
    parts: [...build.parts, ...extra],
    powerPriority: [...build.powerPriority, ...powered],
  }).build;
}

/**
 * Probe fits, brought toward the 14-tier starting budget in Aug 2026. They had
 * been spending 5 to 14 tier against the same cap — the Bastion probes were
 * nearly full while the Mule probes ran at a third — so the one-hour fixture
 * was not comparing chassis at all, it was comparing a kitted hull against two
 * half-empty ones, and the "Bastion is stronger" reading was mostly a budget
 * reading. Measured whole-ladder win rates went from a 0.22-0.72 spread to
 * 0.39-0.72. Additions are identity-appropriate: reach fits get reach, the
 * brawler gets a shell over its gun rather than a fourth barrel.
 */
function probeVultureRange(): Build {
  return withExtraParts(vultureSkirmisher(), [regionalPart('plate3', 'U-ARM', 'left-hardpoint', 1, 0)]);
}
/**
 * The cold-bore sniper, re-cut Aug 2026 to carry two plates instead of four.
 *
 * It was the weakest probe in the set at 0.486 and the only one running a
 * *negative* power margin — a sniper that could not feed its own guns while
 * hauling plating a 255 m fit never gets shot through anyway. Long runs
 * measurably carry less armour than short ones (-19%), and this fit was the
 * clearest instance of the general problem. Dropping two plates takes it to
 * 0.625 and +0.8 kW: from the weakest Vulture fit to the strongest.
 *
 * The same trim was measured on `probe-vulture-range` and
 * `probe-bastion-casemate` and made both *worse* (0.594 -> 0.563 and
 * 0.854 -> 0.844), so their plating stays. This is not a rule about armour, it
 * is one fit that was carrying the wrong thing.
 *
 * Written out rather than grown from `vultureSniper()` because that builder is
 * the balance cohort's, and `withExtraParts` can only add.
 */
function probeVultureColdBuild(): Build {
  const parts: PlacedPart[] = [
    regionalPart('reactor', 'R-E25', 'right-hardpoint', 3, 1),
    regionalPart('cb', 'W-CB', 'left-hardpoint', 1, 0, 90),
    regionalPart('cb2', 'W-CB', 'left-hardpoint', 1, 2, 90),
    regionalPart('coldSink', 'U-HS', 'left-hardpoint', 0, 2),
    regionalPart('sink', 'U-HS', 'body', 2, 3),
    regionalPart('arm1', 'U-ARM', 'left-hardpoint', 0, 1),
    regionalPart('arm2', 'U-ARM', 'body', 2, 0),
  ];
  return wired({
    chassisId: 'CH-2', parts, routes: [],
    powerPriority: [CORE_INSTANCE_ID, 'cb', 'cb2'],
  });
}

function probeVultureClose(): Build {
  return withExtraParts(vultureCloseScout(), [
    regionalPart('plate3', 'U-ARM', 'left-hardpoint', 1, 0),
    regionalPart('plate4', 'U-ARM', 'left-hardpoint', 1, 3),
    regionalPart('sink2', 'U-HS', 'right-hardpoint', 3, 3),
  ]);
}
function probeMuleGunline(): Build {
  return withExtraParts(muleGunline(), [
    regionalPart('mg2', 'W-MG', 'left-shoulder', 1, 0),
    regionalPart('tc', 'U-TC1', 'body', 0, 2),
    regionalPart('plate2', 'U-ARM', 'body', 5, 2),
  ], ['mg2']);
}
function probeMuleThermal(): Build {
  return withExtraParts(muleLaserBoat(), [
    regionalPart('reactorE2', 'R-E25', 'right-shoulder', 3, 0),
    regionalPart('plate2', 'U-ARM', 'left-shoulder', 1, 0),
  ]);
}
function probeMuleBrawler(): Build {
  return withExtraParts(muleSkirmisher(), [
    regionalPart('shell1', 'U-SHELL', 'left-shoulder', 1, 1),
    regionalPart('plate4', 'U-ARM', 'left-shoulder', 1, 0),
  ]);
}
function probeBastionCasemate(): Build {
  return withExtraParts(bastionAutocannonCasemate(), [regionalPart('sink2', 'U-HS', 'left-sponson', 1, 1)]);
}

/** One-hour branch probes: three legal, materially different starts per active chassis. */
export const BRANCH_PROBE_TEMPLATES: TemplateDef[] = [
  { id: 'probe-vulture-range', name: 'Vulture Range Skirmisher', blurb: 'Long-sight carbine with close defense.', build: probeVultureRange() },
  { id: 'probe-vulture-cold', name: 'Vulture Cold-bore Sniper', blurb: 'Twin-carbine overcooled precision opening; plating traded for supply.', build: probeVultureColdBuild() },
  { id: 'probe-vulture-close', name: 'Vulture Armored Scout', blurb: 'Twin-MG close scout with a protected body.', build: probeVultureClose() },
  { id: 'probe-mule-gunline', name: 'Mule Autocannon Gunline', blurb: 'Combustion autocannon firing line with tracking support.', build: probeMuleGunline() },
  { id: 'probe-mule-thermal', name: 'Mule Laser Platform', blurb: 'Hybrid heat-managed laser platform.', build: probeMuleThermal() },
  { id: 'probe-mule-brawler', name: 'Mule Armored Brawler', blurb: 'Cheap sustained fire behind armor, one gun under a shell.', build: probeMuleBrawler() },
  { id: 'probe-bastion-casemate', name: 'Bastion Autocannon Casemate', blurb: 'Protected, targeted sustained fire.', build: probeBastionCasemate() },
  { id: 'probe-bastion-thermal', name: 'Bastion Laser Bunker', blurb: 'Casemate heat spreading and paired radiators.', build: bastionLaserBunker() },
  { id: 'probe-bastion-suppression', name: 'Bastion Suppression Stride', blurb: 'Armored twin-MG platform with powered mobility.', build: bastionSuppressionStride() },
];

/**
 * Opponents the ladder may field. TEMPLATES alone left a hole between tier 9 and
 * tier 18, and its only Bastion base costs 23 — more than the whole ladder ramp
 * spends — so a Bastion never appeared and the chassis it unlocks was
 * unreachable. The Bastion probes are already legal, authored and materially
 * distinct at tier 11-13, which is exactly the missing band. TEMPLATES itself is
 * left alone so the canonical balance cohort does not move.
 */
export const LADDER_TEMPLATES: TemplateDef[] = [
  ...TEMPLATES,
  ...BRANCH_PROBE_TEMPLATES.filter((template) => template.build.chassisId === 'CH-9'),
  { id: 'vulture-scrapper', name: 'Vulture Scrapper', blurb: 'A gun, a plate, and legs. Barely a mech.', build: vultureScrapper() },
  { id: 'mule-runt', name: 'Mule Runt', blurb: 'Salvage frame running one gun off a small plant.', build: muleRunt() },
  { id: 'bastion-picket', name: 'Bastion Picket', blurb: 'An assault hull with almost nothing bolted to it. Still an assault hull.', build: bastionPicket() },
];

/** Factory teaching blueprint, kept outside the canonical balance cohort. */
export const SPATIAL_DEMO_TEMPLATE: TemplateDef = {
  id: 'mule-spatial-demo',
  name: 'Mule Spatial Rig',
  blurb: 'Three regions, routed ports, armoured turret, and a fragile pod chain.',
  build: muleSpatialDemo(),
};
