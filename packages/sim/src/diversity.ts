/**
 * Build-diversity and perk stress harness. Canonical balance asks whether the
 * stock roster has a dominant build; this module asks a different question:
 * whether each chassis supports coherent identities and whether rare perks
 * are active, costly choices instead of dead text or automatic stacks.
 */
import type { Build } from './types.js';
import { getChassis, getUsableCellCount } from './chassis.js';
import { getPart } from './catalog.js';
import { getOccupiedCells } from './grid.js';
import { auditModifierLoadout, MODIFIERS, type ModifierCtx } from './modifiers.js';
import { runBattle, TICK_S } from './combat.js';
import { terrainAt } from './terrain.js';
import { dhypot } from './dmath.js';
import { analyzeRoundRobin, runRoundRobin, type RoundRobinReport } from './harness.js';
import { TEMPLATES, type TemplateDef } from './templates.js';

function templateBuild(id: string): Build {
  const source = TEMPLATES.find((template) => template.id === id);
  if (!source) throw new Error(`Unknown canonical template ${id}`);
  return {
    ...source.build,
    parts: source.build.parts.map((part) => ({
      ...part,
      origin: { ...part.origin },
      modifiers: part.modifiers ? [...part.modifiers] : undefined,
      variant: part.variant ? { ...part.variant } : undefined,
    })),
    powerPriority: [...source.build.powerPriority],
  };
}

function withModifier(build: Build, instanceId: string, modifierId: string): Build {
  return {
    ...build,
    parts: build.parts.map((part) => part.instanceId === instanceId
      ? { ...part, modifiers: [...(part.modifiers ?? []), modifierId] }
      : part),
  };
}

function vultureAmbusherControl(): Build {
  return templateBuild('vulture-sniper');
}

function muleRedlineControl(): Build {
  const build = templateBuild('mule-laser-boat');
  // Build around an inherited flaw: the hot-running laser supplies the
  // temperature ramp while the pipe/radiator highway prevents a shutdown.
  // Put that keystone on the exposed front row: the redline payoff is strong,
  // so spatial construction must give opponents a way to dismantle it.
  const first = build.parts.find((part) => part.instanceId === 'las1')!;
  const second = build.parts.find((part) => part.instanceId === 'las2')!;
  build.parts = build.parts
    .filter((part) => part.instanceId !== 'arm1')
    .map((part) => part.instanceId === 'las1'
      ? { ...part, origin: { ...second.origin }, rotation: second.rotation, modifiers: ['hot-running', 'cold-blooded'] }
      : part.instanceId === 'las2'
        ? { ...part, origin: { ...first.origin }, rotation: first.rotation }
        : part);
  return build;
}

function muleGunshipControl(): Build {
  return templateBuild('mule-skirmisher');
}

function bastionAnchorControl(): Build {
  const build = templateBuild('bastion-tank');
  build.parts = build.parts.map((part) => part.instanceId === 'br'
    ? { ...part, instanceId: 'mg', partId: 'W-MG' }
    : part);
  build.parts.push({
    instanceId: 'act', partId: 'U-ACT',
    origin: { regionId: 'hull', x: 2, y: 7 }, rotation: 0, integrity: 1,
  });
  build.powerPriority = ['__core__', 'act', 'mg'];
  return build;
}

export interface PerkCase {
  id: string;
  chassisId: string;
  identity: string;
  perkId: string;
  control: Build;
  perk: Build;
  /** Instance carrying the conditional perk, used for activation telemetry. */
  carrierId: string;
}

const coldControl = vultureAmbusherControl();
const feverControl = muleRedlineControl();
const gyroControl = muleGunshipControl();
const hullControl = bastionAnchorControl();

export const PERK_CASES: PerkCase[] = [
  {
    id: 'vulture-cold-bore', chassisId: 'CH-2', identity: 'overcooled first-strike ambusher',
    perkId: 'cold-bore', control: coldControl, perk: withModifier(coldControl, 'cb', 'cold-bore'),
    carrierId: 'cb',
  },
  {
    id: 'mule-fever-cycle', chassisId: 'CH-5', identity: 'hot-running redline laser boat',
    perkId: 'fever-cycle', control: feverControl, perk: withModifier(feverControl, 'las1', 'fever-cycle'),
    carrierId: 'las1',
  },
  {
    id: 'mule-gyro-gunship', chassisId: 'CH-5', identity: 'movement-stabilized mobile brawler',
    perkId: 'gyrostabilized', control: gyroControl, perk: withModifier(gyroControl, 'mg1', 'gyrostabilized'),
    carrierId: 'mg1',
  },
  {
    id: 'bastion-hull-down', chassisId: 'CH-9', identity: 'armored hull-down suppression bunker',
    perkId: 'hull-down', control: hullControl, perk: withModifier(hullControl, 'act', 'hull-down'),
    carrierId: 'act',
  },
];

export const PERK_TEMPLATES: TemplateDef[] = PERK_CASES.map((perkCase) => ({
  id: perkCase.id,
  name: perkCase.id,
  blurb: `${perkCase.identity}; ${MODIFIERS[perkCase.perkId]!.blurb}`,
  build: perkCase.perk,
}));

/** Accepted coherent identities; arbitrary legal layouts are intentionally absent. */
export const CHASSIS_IDENTITIES: Record<string, string[]> = {
  'CH-2': ['hybrid range skirmisher', 'ram-air carbine sniper', 'cold-bore ambusher'],
  'CH-5': ['combustion gunline', 'armored twin-MG brawler', 'hybrid laser boat', 'capacitor railgun', 'fever redline laser', 'gyrostabilized mobile brawler'],
  'CH-7': ['spine-mounted long gun', 'sponson autocannon gunline', 'split-reactor laser line'],
  'CH-9': ['armored close siege specialist', 'hull-down suppression bunker'],
};

export interface FittingFreedom {
  id: string;
  chassisId: string;
  totalCells: number;
  kernelCells: number;
  fittingCapacity: number;
  occupiedFittingCells: number;
  freeCells: number;
}

/** Keystone = weapons + reactors; every other occupied cell is fitting. */
export function auditFittingFreedom(templates: TemplateDef[] = [...TEMPLATES, ...PERK_TEMPLATES]): FittingFreedom[] {
  return templates.map((template) => {
    const chassis = getChassis(template.build.chassisId);
    const totalCells = getUsableCellCount(chassis);
    let kernelCells = 0;
    let occupiedCells = 0;
    for (const part of template.build.parts) {
      const cells = getOccupiedCells(part, getPart(part.partId)).length;
      occupiedCells += cells;
      if (['weapon', 'reactor'].includes(getPart(part.partId).category)) kernelCells += cells;
    }
    return {
      id: template.id,
      chassisId: template.build.chassisId,
      totalCells,
      kernelCells,
      fittingCapacity: totalCells - kernelCells,
      occupiedFittingCells: occupiedCells - kernelCells,
      freeCells: totalCells - occupiedCells,
    };
  });
}

export interface PartDifferentiationFinding {
  parts: string;
  verdict: 'distinct' | 'overlap-watch' | 'dead-placeholder';
  evidence: string;
}

/** Focused audit of catalog parts competing for the same cells/job. */
export function auditPartDifferentiation(): PartDifferentiationFinding[] {
  return [
    { parts: 'U-HS vs U-RAD', verdict: 'distinct', evidence: '1-cell burst thermal mass vs 3-cell perimeter-only sustained dissipation.' },
    { parts: 'U-ARM vs U-HS', verdict: 'distinct', evidence: '60 HP/150 kg lane protection vs 6x thermal mass/60 kg heat buffering.' },
    { parts: 'R-E25 vs R-C40', verdict: 'distinct', evidence: '25 kW instant/cool electric vs 40 kW lagged/hot combustion at the same tier.' },
    { parts: 'W-CB vs W-LAS', verdict: 'overlap-watch', evidence: 'Similar precision bands; carbine pays continuous tracking/recoil while laser pays charge spikes, hitscan premium, and heat.' },
    { parts: 'W-PIN vs U-ARM', verdict: 'distinct', evidence: 'The comparison that matters is not against another gun. The Pin is the only one-cell weapon in the game, and a build\'s leftover single cells have never had anything to put in them but a Plate -- almost every assembly ends with a "spare cells" note filling them with armour. So the trade is 60 HP against 6 dps and 15 HP, in the slot where nothing else fits. Against actual guns it is deliberately the worse deal: 6.0 dps per cell against the Stitcher\'s 7.5, so it never displaces one.' },
    { parts: 'W-MG vs W-AC', verdict: 'distinct', evidence: '2-cell cheap close saturation vs 6-cell midrange recoil platform with 8x damage packets.' },
    { parts: 'U-SIGHT vs U-TC1', verdict: 'distinct', evidence: 'The same mech-scale lever bought with different money. Sources multiply, so the question is never which is stronger but which a build can afford: the Abacus is 1 cell and 50 kg for 0.4 and costs 3 kW to run, the Reticle is 3 cells and 220 kg for 0.55 and costs nothing. Power is what binds in practice -- builds in this pass repeatedly read back "energy margin -15.2 kW, but no legal cell is left for a reactor" -- so the Reticle is the only one a browned-out build can use, and the Abacus stays the better computer wherever the watts exist. docs/17 F45: one computer is worth +17 win points and two are worth less than one.' },
    { parts: 'raked-plating vs hull-down vs weaving-gait', verdict: 'distinct', evidence: 'Three mods on the same channel and only one is on when the fight is. hull-down pays below 1.5 m/s and weaving-gait above 4, states docs/17 F38 measured at 6.2% and 19.3% of fight time, which is why both live in deadMods; raked-plating is unconditional and pays 20% of the carrier\'s mass for it. Its value is a gradient nobody authored: F64 measures x0.8 profile at -19% incoming hits on a Vulture and -11% on a Bastion, because erf saturates against a wider silhouette, so it is a light-frame mod by arithmetic.' },
    { parts: 'CH-7 Ridgeline vs CH-5 Mule vs CH-9 Bastion', verdict: 'distinct', evidence: 'chassisTier 3 was the empty rung -- the catalog shipped 1, 2 and 4 with rated mass doubling across them (3/6/12 t), so the missing frame is a 9-tonne one, and every statline here interpolates rather than inventing an axis. The identity is geometric: the spine is a 3x7 block, the only zone in the catalog both wide enough for a 2-cell gun and deep enough to swallow it, so it is the only place W-SR or W-RG can sit WHOLLY inside a zone and claim its effect. The Vulture\'s hardpoints are too narrow for a 2-wide footprint and the Bastion\'s hull offers heat rather than reach, so a 15% range zone on a frame that can actually hold a long gun is a place neither of them has. docs/17 F74.' },
    { parts: 'cold-shroud vs raked-plating', verdict: 'distinct', evidence: 'The same channel bought at two prices, and the second is the only defensive mod in the catalog whose value is bought with cooling. raked-plating is unconditional x0.8 for 20% of the carrier\'s mass. cold-shroud is x0.75 while its mount is under 40 C and x1.2 once the mount passes 50, for half the mass -- so it is strictly better on a build that can hold its heat and strictly worse on one that cannot, and it is the first mod that makes the heat MAP a defensive concern rather than a thermal one. docs/17 F71: a conditional is worth its condition\'s occupancy, and heat occupancy is the build\'s (100% cold with four radiators, 53% hot bare) where terrain occupancy is the autopilot\'s and moves 4 points across its whole range.' },
    { parts: 'lead-cam vs U-TC1', verdict: 'distinct', evidence: 'The same term bought at two scopes and two prices. The Abacus multiplies the lateral penalty for every gun on the mech and costs a cell and 3 kW; lead-cam halves it for one gun and costs that gun 15% of its rate of fire. So the computer is what a multi-gun build wants and the cam is what a single big slow gun wants -- and docs/17 F61 says why either matters: lead is the longer leg of the hit model on every weapon in the catalog, 1.9x to 3.8x, so halving it moves sigma about 48% where halving the cone moves it 2.4%.' },
    { parts: 'U-TC1 vs gyrostabilized', verdict: 'distinct', evidence: 'TC counters target lateral motion for 3 kW; gyro counters own motion but adds substantial weapon mass.' },
    { parts: 'U-ACT', verdict: 'distinct', evidence: '2 cells + 4 kW buy a capped 15% translation-speed boost; perk variants bend terrain or stillness.' },
    { parts: 'U-AMMO', verdict: 'dead-placeholder', evidence: 'Adds cook-off risk but ballistics do not consume ammo yet; not a positive fitting choice until Track C ammo lands.' },
    // Added Aug 2026, when `game:audit` started warning about parts with no
    // verdict at all: sixteen of them had none, so nothing said what they
    // competed with. Every line below is read off the catalog, not estimated.
    { parts: 'U-VENT vs U-RAD', verdict: 'distinct', evidence: 'The same radiator channel at two footprints, and footprint is what decides whether cooling is available at all. The Gill is 1.0 strength over a 3-cell perimeter line; the Vent is 0.45 over one cell, so it is the worse deal per cell and the only one that fits a fragmented perimeter. Three Vents beat one Gill on strength (1.35 to 1.0) and cost three loose cells to do it, so the Gill stays right wherever three in a row exist. docs/17 F36: the build that lives above fire-hold had one free perimeter cell and could not cool at all.' },
    { parts: 'U-DRIVE vs U-ACT', verdict: 'distinct', evidence: 'Both buy translation speed and resolveSpeedMultiplier takes the max, so they supersede rather than stack and the question is which to carry. The Stride is 2 cells, 160 kg and 4 kW for +15%; the Bound is 4 cells, 480 kg and 12 kW for +35%. The mass is what separates them: 480 kg is a load-factor event on a 3 t Vulture and close to free on a 12 t Bastion, so the bigger drive is aimed at the frame that cannot close, which is the one docs/17 F40 shows loses by taking 775 damage on the way in.' },
    { parts: 'U-CON vs U-PIPE', verdict: 'distinct', evidence: '1-cell damageable equipment either way, but one carries 60 kW of power and the other 4 conductance of heat; a port needs whichever layer it is short of.' },
    { parts: 'U-RISE2 vs U-RISE3 vs U-RISEL', verdict: 'overlap-watch', evidence: 'Three risers doing one job — a level of support at 60 kW that also conducts heat. They separate only on footprint and mass (2x2/60 kg, 2x3/90 kg, 1x3/70 kg), so the choice is geometric rather than functional.' },
    // Was 'distinct' on the arc bonus until docs/17 F28 measured the arc: over
    // 195,746 frames of template-vs-template the bearing to the enemy has a
    // median offset of 0.1 deg and a maximum of 11.6, against a narrowest
    // half-arc of 10 deg in the whole catalog. The differentiator is real code
    // that never executes, which is F18's '+0.0 reads like an effect that does
    // nothing' one level up: a *part* whose only distinction measures zero.
    { parts: 'U-TUR vs U-RISE2', verdict: 'overlap-watch', evidence: 'Both lift a gun a level at 60 kW while conducting heat. The gimbal pays 2 kW and 30 kg more for +25 degrees of arc, and arc is inert (docs/17 F28, pinned by mountArc.test.ts) -- the pilot faces its target to within 0.1 degrees, so no gun in the catalog is ever out of arc and the bonus is never collected. Until something can make a mech fight off-axis, this is a strictly more expensive Block.' },
    { parts: 'U-SHELL vs U-ARM', verdict: 'distinct', evidence: '60 HP over 2 cells that seals what it covers (heat x1.25, no passive cooling) vs 60 HP in one cell that only blocks a lane. The Plate is payload and eats a free cell; the Carapace is armour and eats none, but must cover one part exactly.' },
    { parts: 'U-MANTLE vs U-SHELL', verdict: 'distinct', evidence: 'The same sealed armour at the same rates -- 90 kg and 30 HP a cell, tier 2, heat x1.25 and no passive cooling -- cut to a different footprint, which is the only thing that decides what armour can be used on. The Carapace covers a 2-cell line and so fits 4 enabled parts; the Mantle covers 2x2, the commonest payload footprint in the game at 6 parts, and is the only armour that fits a reactor. Sealing a reactor is the decision it exists to create: the part with the most HP worth protecting is also the one that most minds losing its passive cooling.' },
    { parts: 'R-C90 vs R-E60', verdict: 'distinct', evidence: 'The tier-3 repeat of the same choice as R-C40 vs R-E25: 90 kW lagged and hot against 60 kW instant and cool, at 900 kg against 750 kg.' },
    { parts: 'P-CAP vs P-CAP2', verdict: 'distinct', evidence: 'A small snappy reserve against a large slow one — the alpha-strike cap only pays off for a gun that spends it all at once.' },
    { parts: 'W-KL vs W-SR', verdict: 'distinct', evidence: 'The two long guns, and they pay in opposite currencies. The Pinion costs a whole Vulture arm, 1100 kg and a 60 kJ bank for the largest single hit in the catalog at 8.5 dps, and runs stone cold at 2.31 kW. The Kiln is 3 cells and 200 kg with no draw at all, reaches further (125 m ideal midpoint against 100) at 10.7 dps, and dumps 15 kW into the hull -- more than a bare Vulture sheds through its skin. One buys reach with space and mass, the other with heat, and it is the only gun with real range and no recoil because a recoilless rifle vents instead.' },
    { parts: 'W-AV vs W-BR', verdict: 'distinct', evidence: 'The two close-range hammers, separated by what they cost rather than what they do: the Maul is 6 cells and 650 kg for 20 dps, the Anvil 4 cells and 1000 kg for 18.75. The Maul is the better gun wherever cells are free; the Anvil is the one you fit when the cells are gone and the tonnage is not, and at 250 kg/cell it is the only part in the catalog that makes a frame heavy by being worth carrying. Its 25 kN.s of recoil is priced the same way -- 16.7 m/s of kick on a 1.5 t scout against 4.4 on a 5.7 t Mule, so the mass it adds is what makes the next one bearable.' },
    { parts: 'W-RKT vs W-BR', verdict: 'distinct', evidence: 'Both hit hard up close: the pod throws a 6x6 salvo at 20 mrad on a 15 s cycle through a 120-degree arc, the siege gun a single 40 at 6 mrad every 2 s through 45. Saturation vs a hammer.' },
    { parts: 'W-RG vs W-CB', verdict: 'distinct', evidence: 'The two long guns: 85 damage at 1.2 mrad from a 10-cell tier-4 mount fed 220 kJ a shot, against 8 damage at 2 mrad from 2 cells with no draw at all.' },
    { parts: 'W-BMB vs W-CV', verdict: 'distinct', evidence: 'Both are 6-cell tier-4 long guns around a tonne, and the Bombard is the only weapon in the catalog that cannot shoot at close range at all: falloff.min 60 m, where fights currently spend 30.8% of their time (docs/17 F54). It buys the best sustained damage of any long gun, 13.6 dps against the Culverin 11.7, and pays for it twice -- the dead zone, and 200 m/s that is 0.95 s of flight at 190 m, so it eats the lead error the Lance exists to escape. The Culverin can defend itself and hits a crosser; the Bombard does neither and out-damages both.' },
    { parts: 'W-LNC vs W-KL vs W-CV', verdict: 'distinct', evidence: 'Three long guns and the Lance is the only one whose shots arrive instantly. Lead error scales with time of flight and every other long gun is a projectile -- the Culverin spends 0.54 s in the air at 140 m and hits 52%. The Lance trades damage per shot for that: 13 against the Kiln 32 and the Culverin 70, on a 1.2 s cycle, so it is chip damage that never misses for want of leading against two guns that hit hard, slowly, and behind a crossing target. It pays 12 kW sustained, between the Kiln 15 and the laser 4.5, and heat rather than power on purpose because the completer repairs a power deficit before anything is scored (docs/17 F47).' },
    { parts: 'W-CV vs W-RG vs W-SR', verdict: 'distinct', evidence: 'Three long guns paying in three currencies. The Longshot buys reach with 10 cells and 220 kJ a shot at 17 dps; the Pinion with a whole Vulture arm at 8.5. The Culverin buys it with mass it does not carry itself: 30 kN.s of recoil is 16 m/s of kick on a 1.88 t Vulture -- past its own top speed, every shot -- and 4.2 on a 7.09 t Bastion, so the frame is what makes the gun work. 11.7 dps is deliberately mid-table; it is not the best long gun, it is the one a heavy frame can hold still, and it is the first part in the catalog that wants a Bastion.' },
    { parts: 'W-SR vs W-RG', verdict: 'distinct', evidence: 'Both are tier-4 long guns, and the difference is the frame each is cut for. The Longshot is a 2x5 block: no light chassis has a region two cells wide, so it is a heavy-frame gun. The Pinion is the shape of a Vulture hardpoint, so it costs a scout one entire arm and nothing else can share that arm -- and being wholly inside a hardpoint it takes the long-sight bonus, which the Longshot can never claim. 110 damage on a 13 s cycle against 85 on a 5 s cycle is the trade: the Pinion carries the largest single hit in the catalog and buys reach and a light frame with rate of fire, at 8.5 dps against 17.' },
    { parts: 'W-SER vs W-SC vs W-ION', verdict: 'distinct', evidence: 'Three system-attacking guns and the Sear is the one whose target always exists. The ion drains capacitors and six of seven panel templates carry none (docs/17 F37); the Scald cooks at 15 kJ/s and is a 3-damage gun inside 20 m. The Sear takes the flamer\'s mechanism to 40-100 m at 11.25 kJ/s and 5 dps -- the lowest in the catalog -- so it is a disabling weapon rather than a killing one: past 115 C the struck part holds fire, past 130 it shuts down. It pays 7.5 kW of its own heat to spend the enemy\'s.' },
    { parts: 'W-SC vs W-ION', verdict: 'distinct', evidence: 'Both attack a system rather than HP, and opposite ones: the flamer dumps 6 kJ into the struck cell inside 45 m, the ion bleeds 25 kJ of stored charge out to 150 m.' },
  ];
}

export interface PerkStressResult {
  report: RoundRobinReport;
  cases: {
    id: string;
    perkId: string;
    controlWinRate: number;
    perkWinRate: number;
    delta: number;
    activationRate: number;
    bestMatchup: { opponentId: string; delta: number };
    worstMatchup: { opponentId: string; delta: number };
    loadoutIssues: ReturnType<typeof auditModifierLoadout>;
  }[];
  dominantCombinations: string[];
  deadPerks: string[];
  stackingRejection: ReturnType<typeof auditModifierLoadout>;
}

function cohortResults(build: Build, seeds: number, baseSeed: number): { winRate: number; byOpponent: Record<string, number> } {
  let wins = 0;
  let battles = 0;
  const byOpponent: Record<string, number> = {};
  for (let opponentIndex = 0; opponentIndex < TEMPLATES.length; opponentIndex++) {
    const opponent = TEMPLATES[opponentIndex]!.build;
    let opponentWins = 0;
    for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
      const flip = seedIndex % 2 === 1;
      const report = runBattle({
        builds: flip ? [opponent, build] : [build, opponent],
        seed: baseSeed + opponentIndex * 1009 + seedIndex,
        recordFrames: false,
      });
      if (report.winner !== 'draw' && (report.winner === 0) === !flip) { wins++; opponentWins++; }
      battles++;
    }
    byOpponent[TEMPLATES[opponentIndex]!.id] = opponentWins / seeds;
  }
  return { winRate: battles > 0 ? wins / battles : 0, byOpponent };
}

/**
 * How often the perk's conditional half is actually in effect.
 *
 * The condition is read from the modifier registry, never restated here. This
 * function used to carry an if/else chain keyed on `perkId` with the thresholds
 * retyped, and it drifted: hull-down was counted below 0.5 m/s where the perk
 * fires below 1.5, which under-reported it sevenfold and printed a live perk as
 * dead. It also had no fallthrough, so a perk added to PERK_CASES without a
 * branch silently measured 0% and was reported dead by default -- the failure
 * pointed the wrong way.
 *
 * A modifier with no declared `isActive` is unconditional and counts every
 * tick, which is the truthful reading for something like gyrostabilized.
 */
function activationRate(perkCase: PerkCase, seeds: number, baseSeed: number): number {
  const modifier = MODIFIERS[perkCase.perkId];
  if (!modifier) throw new Error(`Perk case ${perkCase.id} names unknown modifier ${perkCase.perkId}`);
  const carrier = perkCase.perk.parts.find((part) => part.instanceId === perkCase.carrierId);
  if (!carrier) throw new Error(`Perk case ${perkCase.id} names unfitted carrier ${perkCase.carrierId}`);
  const carrierDef = getPart(carrier.partId);
  if (!modifier.isActive) return 1;

  let active = 0;
  let samples = 0;
  // Measure the conditional over the same complete canonical opponent set as
  // the control/perk comparison. A single hand-picked benchmark can call a
  // situational perk dead merely because that opponent never exposes its
  // condition.
  for (let opponentIndex = 0; opponentIndex < TEMPLATES.length; opponentIndex++) {
    const opponent = TEMPLATES[opponentIndex]!.build;
    for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
      const flip = seedIndex % 2 === 1;
      const report = runBattle({
        builds: flip ? [opponent, perkCase.perk] : [perkCase.perk, opponent],
        seed: baseSeed + opponentIndex * 1009 + seedIndex,
        recordFrames: true,
      });
      const selfIndex = flip ? 1 : 0;
      for (let frameIndex = 0; frameIndex < report.frames.length; frameIndex++) {
        const frame = report.frames[frameIndex]!;
        const mech = frame.mechs[selfIndex];
        const previous = report.frames[Math.max(0, frameIndex - 1)]!.mechs[selfIndex];
        const weapon = mech.weapons.find((w) => w.instanceId === perkCase.carrierId);
        const ctx: ModifierCtx = {
          // A frame carries per-part temperature only for weapons. Every
          // temperature-conditioned modifier shipped is `appliesTo: isWeapon`,
          // so this is exact today; a future one on a non-weapon carrier (as
          // hull-down already is) would read the mech's hottest cell instead,
          // which is an over-estimate rather than a silent undefined.
          tempC: weapon?.tempC ?? mech.hottestCellC,
          speedMps: dhypot(mech.x - previous.x, mech.y - previous.y) / TICK_S,
          tile: terrainAt(report.terrain, mech.x, mech.y),
        };
        samples++;
        if (modifier.isActive(ctx, carrierDef)) active++;
      }
    }
  }
  return samples > 0 ? active / samples : 0;
}

export function runPerkStress(seeds = 5, baseSeed = 20_000): PerkStressResult {
  const report = runRoundRobin([...TEMPLATES, ...PERK_TEMPLATES], { seedsPerPair: seeds, baseSeed: 1 });
  const cases = PERK_CASES.map((perkCase, index) => {
    // The control/perk comparison is a *paired difference* between two noisy win
    // rates, so it needs more samples than the round robin's levels do. At the
    // round robin's 5 seeds a matchup delta can only land on multiples of 0.2,
    // and cold-bore -- which changed the outcome of 23 of 35 fights -- measured a
    // delta of exactly zero because the wins happened to cancel, and was reported
    // dead. At 3x it measures +8 points with a +18 best matchup, which is what it
    // actually is. Raising resolution rather than relaxing the criterion: the gate
    // was right to demand a positive matchup, it just could not see one.
    const comparisonSeeds = seeds * 3;
    const control = cohortResults(perkCase.control, comparisonSeeds, baseSeed + index * 20_000);
    const perk = cohortResults(perkCase.perk, comparisonSeeds, baseSeed + index * 20_000);
    const matchupDeltas = TEMPLATES.map((opponent) => ({
      opponentId: opponent.id,
      delta: perk.byOpponent[opponent.id]! - control.byOpponent[opponent.id]!,
    }));
    matchupDeltas.sort((a, b) => b.delta - a.delta || a.opponentId.localeCompare(b.opponentId));
    return {
      id: perkCase.id,
      perkId: perkCase.perkId,
      controlWinRate: control.winRate,
      perkWinRate: perk.winRate,
      delta: perk.winRate - control.winRate,
      activationRate: activationRate(perkCase, seeds, baseSeed + index * 20_000 + 10_000),
      bestMatchup: matchupDeltas[0]!,
      worstMatchup: matchupDeltas[matchupDeltas.length - 1]!,
      loadoutIssues: auditModifierLoadout(perkCase.perk),
    };
  });
  const stackedFever = withModifier(withModifier(feverControl, 'las1', 'fever-cycle'), 'las2', 'fever-cycle');
  const perkTemplateIds = new Set(PERK_TEMPLATES.map((template) => template.id));
  return {
    report,
    cases,
    // Canonical roster dominance has its own larger, fixed opponent cohort in
    // sim:balance. This stress gate owns perk combinations; mixing the two made
    // a canonical build fail only because a retired perk opponent disappeared.
    dominantCombinations: report.standings
      .filter((standing) => perkTemplateIds.has(standing.id) && standing.winRate > 0.7)
      .map((standing) => standing.id),
    deadPerks: cases.filter((entry) => entry.activationRate < 0.05 || entry.bestMatchup.delta <= 0).map((entry) => entry.perkId),
    stackingRejection: auditModifierLoadout(stackedFever),
  };
}

export function formatDiversityReport(result: PerkStressResult): string {
  const summary = analyzeRoundRobin(result.report);
  const lines = [
    `Diversity stress: ${result.report.standings.length} builds, ${result.report.battles} battles`,
    `Healthy matchups: ${summary.healthyMatchups}/${summary.totalMatchups}; dominant perk combinations: ${result.dominantCombinations.join(', ') || 'none'}`,
    '',
    'Perk cases (same canonical opponents and seeds for control/perk):',
  ];
  for (const entry of result.cases) {
    lines.push(`  ${entry.id.padEnd(24)} control ${Math.round(entry.controlWinRate * 100)}% -> perk ${Math.round(entry.perkWinRate * 100)}%  delta ${Math.round(entry.delta * 100)} pts  active ${Math.round(entry.activationRate * 100)}%  best ${entry.bestMatchup.opponentId} ${Math.round(entry.bestMatchup.delta * 100) >= 0 ? '+' : ''}${Math.round(entry.bestMatchup.delta * 100)}`);
  }
  lines.push('', 'Representative standings:');
  for (const standing of result.report.standings) {
    lines.push(`  ${standing.id.padEnd(24)} ${Math.round(standing.winRate * 100)}%  (${standing.wins}W ${standing.losses}L ${standing.draws}D)`);
  }
  lines.push('', `Dead perks: ${result.deadPerks.join(', ') || 'none'}`);
  lines.push(`Rejected fever stacking: ${result.stackingRejection.map((issue) => issue.message).join('; ') || 'NOT CAUGHT'}`);
  lines.push('', 'Fitting freedom (cells after weapon+reactor kernel / free after coherent build):');
  for (const fit of auditFittingFreedom()) {
    lines.push(`  ${fit.id.padEnd(24)} ${fit.chassisId}  fitting ${fit.fittingCapacity}/${fit.totalCells}  free ${fit.freeCells}`);
  }
  lines.push('', 'Overlapping-part audit:');
  for (const finding of auditPartDifferentiation()) {
    lines.push(`  ${finding.verdict.padEnd(16)} ${finding.parts}: ${finding.evidence}`);
  }
  return lines.join('\n');
}
