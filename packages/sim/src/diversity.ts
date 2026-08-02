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
import { auditModifierLoadout, MODIFIERS } from './modifiers.js';
import { runBattle } from './combat.js';
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
    { parts: 'W-MG vs W-AC', verdict: 'distinct', evidence: '2-cell cheap close saturation vs 6-cell midrange recoil platform with 8x damage packets.' },
    { parts: 'U-TC1 vs gyrostabilized', verdict: 'distinct', evidence: 'TC counters target lateral motion for 3 kW; gyro counters own motion but adds substantial weapon mass.' },
    { parts: 'U-ACT', verdict: 'distinct', evidence: '2 cells + 4 kW buy a capped 15% translation-speed boost; perk variants bend terrain or stillness.' },
    { parts: 'U-AMMO', verdict: 'dead-placeholder', evidence: 'Adds cook-off risk but ballistics do not consume ammo yet; not a positive fitting choice until Track C ammo lands.' },
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

function activationRate(perkCase: PerkCase, seeds: number, baseSeed: number): number {
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
        const carrier = mech.weapons.find((weapon) => weapon.instanceId === perkCase.carrierId);
        const previous = report.frames[Math.max(0, frameIndex - 1)]!.mechs[selfIndex];
        const speed = dhypot(
          mech.x - previous.x,
          mech.y - previous.y,
        ) / 0.05;
        samples++;
        if (perkCase.perkId === 'cold-bore' && carrier && carrier.tempC < 40) active++;
        else if (perkCase.perkId === 'fever-cycle' && carrier && carrier.tempC > 50) active++;
        else if (perkCase.perkId === 'gyrostabilized' && speed > 0.5) active++;
        else if (perkCase.perkId === 'hull-down' && speed < 0.5) active++;
      }
    }
  }
  return samples > 0 ? active / samples : 0;
}

export function runPerkStress(seeds = 5, baseSeed = 20_000): PerkStressResult {
  const report = runRoundRobin([...TEMPLATES, ...PERK_TEMPLATES], { seedsPerPair: seeds, baseSeed: 1 });
  const cases = PERK_CASES.map((perkCase, index) => {
    const control = cohortResults(perkCase.control, seeds, baseSeed + index * 20_000);
    const perk = cohortResults(perkCase.perk, seeds, baseSeed + index * 20_000);
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
