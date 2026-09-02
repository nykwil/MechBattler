/**
 * The workbench: turn a wish into a legal, wired, sound mech, then fight it.
 *
 * Authoring a build used to mean hand-typing a cell reference and rotation for
 * every part in `templates.ts`, and re-typing them all when a placement rule
 * changed. That is the right cost for the canonical roster, which is content;
 * it is the wrong cost for the twenty throwaway builds you want to try while
 * verifying one new part. So: name the parts that matter, let the placer find
 * cells, and let completion supply the boring half — a reactor that covers the
 * measured draw, cooling that covers the measured heat, and routing.
 *
 * Completion invents no numbers. It reads `computeEnergyMargin` and
 * `computeHeatBalance` — the same figures the workshop's gauges show — and adds
 * the smallest part that closes the measured gap. A build it hands back is one
 * the player could have built by hand, because every placement went through the
 * workshop's own rules.
 */
import type { Build, PlacedPart } from './types.js';
import { getPart, PARTS } from './catalog.js';
import { getChassis } from './chassis.js';
import { placeParts } from './assembly.js';
import { applyAutoWire } from './autowire.js';
import {
  computeBurstDps, computeCapacitorBank, computeEnergyMargin, computeHeatBalance,
  computeIdealRangeBand, computeSpeedProfile,
} from './derivedStats.js';
import { computeBudget } from './harness.js';
import { validateBuild, type BuildIssue } from './validation.js';
import { UNIQUES, identifyUnique } from './uniques.js';
import { evaluateMatchup } from './adaptation.js';
import { TEMPLATES, type TemplateDef } from './templates.js';

export interface WishPart {
  partId: string;
  /** How many. Default 1. */
  count?: number;
  /** A named unique (docs/04 §4c). Stamps its mod, quirks and variant on every copy. */
  unique?: string;
  /** Modifiers to stamp instead, when you are testing a mod rather than a unique. */
  modifiers?: string[];
  variant?: PlacedPart['variant'];
  /** Place toward the front rows. Default true for armour, false otherwise. */
  frontFirst?: boolean;
}

export interface BuildWish {
  chassisId: string;
  /** The parts you actually care about. Order matters: earlier parts get first pick of cells. */
  parts: WishPart[];
  /**
   * Supply a reactor and cooling to cover what the named parts demand, then
   * route. Default true — the point of the tool is a *sound* mech quickly.
   */
  complete?: boolean;
  /** Fill leftover cells with armour, up to `budget`. Default true. */
  fillArmour?: boolean;
  /** Tier-budget ceiling for anything completion adds. Default: uncapped. */
  budget?: number;
  /**
   * Restrict completion to this set of part ids. Without it, completion reaches
   * into the whole catalog for a reactor or a radiator, which would hand every
   * locked search the same reactor and make the lock meaningless.
   *
   * Conduits and heat pipes are exempt -- routing is structure tax laid by
   * auto-wire, and a lock that happened to omit a conduit would forbid wiring
   * rather than restrict gear. Omission preserves the whole-catalog behaviour
   * `sim:try` relies on.
   */
  pool?: readonly string[];
  /**
   * Exact number of armour plates to fit, instead of filling every spare cell.
   *
   * Weight is a real axis of what a build IS, and the automatic fill flattens
   * it to one value: every build comes back as heavy as its hull allows. A
   * search that wants light builds to exist has to be able to ask for them.
   *
   * Fewer may be fitted than asked for. The brownout trim below still takes
   * plates back off when their own mass browns the build out, and there may be
   * no legal cell left -- so this is a request, not a guarantee. `fillArmour`
   * still governs when this is omitted.
   */
  armourPlates?: number;
}

export interface AssemblyReport {
  build: Build;
  /** What was asked for and could not be fitted — the first thing to read. */
  unplaced: { partId: string; wanted: number; placed: number }[];
  /** What completion supplied, and the measured reason it did. */
  added: { partId: string; count: number; why: string }[];
  /**
   * What completion wanted to add and could not fit. A stall here is the
   * finding — "this fit is 0.4 kW short and there is no legal 2x2 left for
   * another reactor" is exactly what a content trial needs to be told, rather
   * than being handed a build with an unexplained warning on it.
   */
  blocked: { partId: string; why: string }[];
  budget: number;
  energyMarginKw: number;
  heatMarginKw: number;
  /** `validateBuild` output: errors mean it could not be launched. */
  issues: BuildIssue[];
  legal: boolean;
  /** Named uniques the finished build carries, by part instance. */
  uniques: { instanceId: string; uniqueId: string; name: string }[];
}

const EMPTY = (chassisId: string): Build => ({
  chassisId, parts: [], routes: [], powerPriority: [],
});

/** Reactors and radiators, cheapest-first, so completion adds the smallest thing that works. */
const byOutput = (ids: string[], key: (id: string) => number) =>
  ids.filter((id) => PARTS[id]).sort((a, b) => key(a) - key(b));

const REACTORS = () => byOutput(
  Object.keys(PARTS).filter((id) => PARTS[id]!.reactor),
  (id) => PARTS[id]!.reactor!.outputKw,
);

const CAPACITORS = () => byOutput(
  Object.keys(PARTS).filter((id) => PARTS[id]!.capacitor),
  (id) => PARTS[id]!.capacitor!.storedKj,
);

/**
 * Assemble a wish into a build. Never throws on an impossible wish — it returns
 * what fitted plus what did not, because "the Longshot and two Furnaces do not
 * co-exist on a Vulture" is a finding, not an error.
 */
export function assembleBuild(wish: BuildWish): AssemblyReport {
  const chassis = getChassis(wish.chassisId);
  // Routing is always recomputed from the parts as they stand, never patched.
  // Wiring once mid-assembly and then placing more equipment buried the routes
  // under it, and the build came back with three `route-on-equipment` faults it
  // had given itself.
  const rewire = (b: Build): Build => applyAutoWire(chassis, { ...b, routes: [] }).build;
  const allowed = wish.pool ? new Set(wish.pool) : undefined;
  const inPool = (partId: string): boolean => {
    if (!allowed) return true;
    const def = getPart(partId);
    return def.isConduit || def.isHeatPipe || allowed.has(partId);
  };
  let build = EMPTY(wish.chassisId);
  const unplaced: AssemblyReport['unplaced'] = [];
  const added: AssemblyReport['added'] = [];
  const blocked: AssemblyReport['blocked'] = [];

  // Seed a reactor before anything else when the wish does not name one. The
  // workshop tells a player the same thing on an empty chassis ("start with a
  // reactor"), and for the same reason: a reactor is the largest rigid
  // footprint most builds carry, and parts placed first fragment the grid
  // around it. Placing guns first and asking for power afterwards left a
  // 16-cell Vulture with no legal 2x2 block anywhere and no way to power its
  // own carbines.
  const wantsReactor = wish.parts.some((part) => getPart(part.partId).reactor);
  if (wish.complete !== false && !wantsReactor) {
    const smallest = REACTORS().filter(inPool)[0];
    if (smallest && withinBudget(build, smallest, wish.budget)) {
      const seeded = placeParts(build, smallest, 1, { prefix: 'wb' });
      if (seeded.placed > 0) {
        build = seeded.build;
        added.push({ partId: smallest, count: 1, why: 'every build needs a power path' });
      }
    }
  }

  for (const want of wish.parts) {
    const count = want.count ?? 1;
    const unique = want.unique ? UNIQUES[want.unique] : undefined;
    if (want.unique && !unique) {
      unplaced.push({ partId: want.partId, wanted: count, placed: 0 });
      continue;
    }
    const partId = unique?.partId ?? want.partId;
    const result = placeParts(build, partId, count, {
      prefix: 'wb',
      frontFirst: want.frontFirst ?? partId === 'U-ARM',
      modifiers: unique ? [unique.modifierId, ...unique.quirkIds] : want.modifiers,
      variant: unique ? { ...unique.variant } : want.variant,
    });
    build = result.build;
    if (result.placed < count) unplaced.push({ partId, wanted: count, placed: result.placed });
  }

  if (wish.complete !== false) {
    build = rewire(build);

    // Power. The margin alone is not the question: a build with no reactor at
    // all measures a margin of zero, because supply and demand are both summed
    // over networks and it has none. So ask the workshop's own audit whether
    // anything is unpowered, and only then ask the margin how much is missing.
    for (let guard = 0; guard < 6; guard++) {
      const margin = computeEnergyMargin(chassis, build);
      const faults = new Set(validateBuild(chassis, build)
        .filter((issue) => issue.severity === 'error' || issue.severity === 'warn')
        .map((issue) => issue.code));
      // `cannot-sustain-fire` counts: a build that measures a margin of exactly
      // zero still browns out its own guns, and the workshop says so.
      const unpowered = faults.has('unpowered-parts') || faults.has('core-unpowered')
        || faults.has('network-starved') || faults.has('cannot-sustain-fire');
      if (!unpowered && margin.marginKw > 0) break;
      // A deficit names its own size; an unpowered build has not measured one
      // yet, so start at the smallest and let the next pass read the margin.
      const need = Math.max(0, -margin.marginKw);
      const options = REACTORS().filter(inPool);
      const pick = options.find((id) => PARTS[id]!.reactor!.outputKw >= need) ?? options[options.length - 1];
      const shortfall = unpowered && margin.marginKw >= 0 ? 'something had no power path' : `energy margin ${margin.marginKw.toFixed(1)} kW`;
      if (!pick) {
        // A lock with no reactor in it is a finding about the lock, not an
        // excuse to reach past it into the catalog.
        blocked.push({ partId: '(reactor)', why: `${shortfall}, but the lock has no reactor in it` });
        break;
      }
      if (!withinBudget(build, pick, wish.budget)) {
        blocked.push({ partId: pick, why: `${shortfall}, but the budget is spent` });
        break;
      }
      const result = placeParts(build, pick, 1, { prefix: 'wb', requireConnected: false });
      if (result.placed === 0) {
        blocked.push({ partId: pick, why: `${shortfall}, but no legal cell is left for one` });
        break;
      }
      build = rewire(result.build);
      added.push({
        partId: pick,
        count: 1,
        why: unpowered && margin.marginKw >= 0 ? 'something still had no power path' : `energy margin was ${margin.marginKw.toFixed(1)} kW`,
      });
    }

    // Capacitors: a capacitor-fed gun with no bank can never fire, and
    // `validateBuild` says exactly that in `cap-starved-weapon`. This was the
    // one measured fault completion ignored, and the cost was not small: a
    // cap-fed gun scores 0% alone and 33-44% once its reactor and bank are
    // there, so every single-part step toward one is a loss and a hill-climbing
    // search can never reach the working build. Both capacitor-fed weapons in
    // the catalog -- `W-RG` and `W-SR` -- were reported as dead gear by
    // `sim:breed` for this reason and no other, while every mechanical and
    // charged gun was fine. See docs/17 F16.
    //
    // The bank has to cover the largest single shot, not merely exist: a gun
    // that spends 260 kJ at once is still starved by a 60 kJ Jolt.
    for (let guard = 0; guard < 6; guard++) {
      const needKj = Math.max(0, ...build.parts
        .map((part) => getPart(part.partId).draw?.capFedEnergyPerShotKj ?? 0));
      if (needKj <= 0) break;
      if (computeCapacitorBank(build).storedKj >= needKj) break;
      const why = `a capacitor-fed gun needs ${needKj.toFixed(0)} kJ a shot`;
      const options = CAPACITORS().filter(inPool);
      if (options.length === 0) {
        blocked.push({ partId: '(capacitor)', why: `${why}, but the lock has no capacitor in it` });
        break;
      }
      // Banks add up, so the question is never "which single capacitor covers
      // the shot" — it is "what fits". Largest first because fewer, bigger
      // banks waste fewer cells, then down to the smallest, and the loop runs
      // again to accumulate. Picking only the largest and giving up when it
      // did not fit left a Vulture with five free cells and no capacitor,
      // because a 4-cell Reservoir will not fit beside a gun that eats an arm
      // and a 2-cell Jolt would have.
      let placedOne = false;
      for (const pick of [...options].reverse()) {
        if (!withinBudget(build, pick, wish.budget)) continue;
        const result = placeParts(build, pick, 1, { prefix: 'wb', requireConnected: false });
        if (result.placed === 0) continue;
        build = rewire(result.build);
        added.push({ partId: pick, count: 1, why });
        placedOne = true;
        break;
      }
      if (!placedOne) {
        blocked.push({ partId: '(capacitor)', why: `${why}, but no capacitor fits in the cells and budget left` });
        break;
      }
    }

    // Heat: radiators until the measured balance is non-negative.
    for (let guard = 0; guard < 8; guard++) {
      const heat = computeHeatBalance(chassis, build);
      if (heat.marginKw >= 0) break;
      if (!inPool('U-RAD')) {
        blocked.push({ partId: 'U-RAD', why: `heat balance ${heat.marginKw.toFixed(1)} kW, but the lock has no radiator in it` });
        break;
      }
      if (!withinBudget(build, 'U-RAD', wish.budget)) {
        blocked.push({ partId: 'U-RAD', why: `heat balance ${heat.marginKw.toFixed(1)} kW, but the budget is spent` });
        break;
      }
      const result = placeParts(build, 'U-RAD', 1, { prefix: 'wb' });
      if (result.placed === 0) {
        blocked.push({ partId: 'U-RAD', why: `heat balance ${heat.marginKw.toFixed(1)} kW, but no perimeter cell is left for a radiator` });
        break;
      }
      build = rewire(result.build);
      added.push({ partId: 'U-RAD', count: 1, why: `heat balance was ${heat.marginKw.toFixed(1)} kW` });
    }

    const wantPlates = wish.armourPlates;
    const armourAllowed = inPool('U-ARM') && wantPlates !== 0
      && (wantPlates !== undefined || wish.fillArmour !== false);
    if (armourAllowed) {
      // Strip routing before the fill so plates compete for cells with parts,
      // not with wires that are about to be redrawn anyway.
      build = { ...build, routes: [] };
      const plateIds: string[] = [];
      while ((wantPlates === undefined || plateIds.length < wantPlates)
        && withinBudget(build, 'U-ARM', wish.budget)) {
        const result = placeParts(build, 'U-ARM', 1, { prefix: 'wb', frontFirst: true });
        if (result.placed === 0) break;
        build = result.build;
        plateIds.push(build.parts[build.parts.length - 1]!.instanceId);
      }
      // Armour is mass, and mass is locomotion draw, so filling the hull can
      // push a build that balanced a moment ago into brownout. The fill answers
      // for that itself: plates come back off until the reactor covers the mech
      // they are bolted to. Found by the tool reporting a warning it had caused.
      let trimmed = 0;
      while (plateIds.length > 0) {
        build = rewire(build);
        const margin = computeEnergyMargin(chassis, build);
        const faults = new Set(validateBuild(chassis, build).map((issue) => issue.code));
        if (margin.marginKw >= 0 && !faults.has('cannot-sustain-fire')) break;
        const id = plateIds.pop()!;
        build = {
          ...build,
          parts: build.parts.filter((part) => part.instanceId !== id),
          powerPriority: build.powerPriority.filter((entry) => entry !== id),
        };
        trimmed++;
      }
      if (plateIds.length > 0) {
        added.push({
          partId: 'U-ARM',
          count: plateIds.length,
          why: trimmed > 0
            ? `spare cells; ${trimmed} more came back off — their mass browned the build out`
            : 'spare cells and budget',
        });
      }
    }

    build = rewire(build);
  }

  const issues = validateBuild(chassis, build);
  return {
    build,
    unplaced,
    added,
    blocked,
    budget: computeBudget(build),
    energyMarginKw: computeEnergyMargin(chassis, build).marginKw,
    heatMarginKw: computeHeatBalance(chassis, build).marginKw,
    issues,
    legal: !issues.some((issue) => issue.severity === 'error'),
    uniques: build.parts.flatMap((part) => {
      const unique = identifyUnique(part);
      return unique ? [{ instanceId: part.instanceId, uniqueId: unique.id, name: unique.name }] : [];
    }),
  };
}

function withinBudget(build: Build, partId: string, budget: number | undefined): boolean {
  if (budget === undefined) return true;
  return computeBudget(build) + getPart(partId).tier <= budget;
}

export interface BuildVerdict {
  budget: number;
  /** Win rate against each canonical template, spawn-side balanced. */
  matchups: { templateId: string; winRate: number }[];
  overall: number;
  /** Templates it cannot beat at all, and ones it never loses to. */
  hardCounters: string[];
  freeWins: string[];
}

/**
 * Fight a build against the canonical roster. This is `sim:balance`'s question
 * asked about one experimental build instead of the whole cohort, so a content
 * trial costs seconds rather than a four-minute round robin.
 */
export function evaluateBuild(
  build: Build,
  options: { seeds?: number; baseSeed?: number; opponents?: TemplateDef[] } = {},
): BuildVerdict {
  const seeds = options.seeds ?? 6;
  const baseSeed = options.baseSeed ?? 9000;
  const opponents = options.opponents ?? TEMPLATES;
  const matchups = opponents.map((template) => ({
    templateId: template.id,
    winRate: evaluateMatchup(build, template.build, seeds, baseSeed),
  }));
  const overall = matchups.reduce((sum, m) => sum + m.winRate, 0) / Math.max(1, matchups.length);
  return {
    budget: computeBudget(build),
    matchups,
    overall,
    hardCounters: matchups.filter((m) => m.winRate === 0).map((m) => m.templateId),
    freeWins: matchups.filter((m) => m.winRate === 1).map((m) => m.templateId),
  };
}

/**
 * One screen of report: what was built, whether it is sound, and how it fares.
 * Deliberately terse — this is read dozens of times in a content session, so it
 * has to be scannable, and anything it prints must come from the sim.
 */
/** Signed to one decimal, without the `-0.0` a bare toFixed produces. */
function signed(kw: number): string {
  const rounded = Number(kw.toFixed(1)) || 0;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

export function formatBuildTrial(assembly: AssemblyReport, verdict?: BuildVerdict): string {
  const chassis = getChassis(assembly.build.chassisId);
  const lines: string[] = [];
  const counts = new Map<string, number>();
  for (const part of assembly.build.parts) counts.set(part.partId, (counts.get(part.partId) ?? 0) + 1);

  const speed = computeSpeedProfile(chassis, assembly.build);
  const dps = computeBurstDps(assembly.build);
  const band = computeIdealRangeBand(assembly.build);

  lines.push(`${chassis.name} (${assembly.build.chassisId}) — tier ${assembly.budget}, ${speed.massT.toFixed(2)} t`);
  for (const unique of assembly.uniques) lines.push(`  carrying ${unique.name}`);
  lines.push('');
  lines.push('  fit');
  for (const [partId, count] of [...counts].sort()) {
    const carried = assembly.build.parts.filter((part) => part.partId === partId && part.modifiers?.length);
    const mods = [...new Set(carried.flatMap((part) => part.modifiers ?? []))];
    lines.push(`    ${count} x ${partId.padEnd(8)} ${getPart(partId).name}${mods.length > 0 ? `  [${mods.join(', ')}]` : ''}`);
  }
  for (const add of assembly.added) lines.push(`    + ${add.count} x ${add.partId} — ${add.why}`);
  for (const stall of assembly.blocked) {
    lines.push(`    ! wanted another ${stall.partId} — ${stall.why}`);
  }
  for (const miss of assembly.unplaced) {
    lines.push(`    ! ${miss.partId}: asked for ${miss.wanted}, fitted ${miss.placed} — no legal cell`);
  }

  lines.push('');
  lines.push('  measured');
  lines.push(`    power   ${signed(assembly.energyMarginKw)} kW margin`);
  lines.push(`    heat    ${signed(assembly.heatMarginKw)} kW margin`);
  lines.push(`    guns    ${dps.totalDps.toFixed(1)} burst dps, ideal ${band.bandStart.toFixed(0)}-${band.bandEnd.toFixed(0)} m${band.mismatched ? ' (mismatched bands)' : ''}`);
  lines.push(`    speed   ${speed.fwd.toFixed(1)} fwd / ${speed.strafe.toFixed(1)} strafe / ${speed.rev.toFixed(1)} rev m/s`);

  const errors = assembly.issues.filter((issue) => issue.severity === 'error');
  const warns = assembly.issues.filter((issue) => issue.severity === 'warn');
  if (errors.length > 0 || warns.length > 0) {
    lines.push('');
    lines.push('  faults');
    for (const issue of [...errors, ...warns]) lines.push(`    ${issue.severity === 'error' ? 'FAULT' : 'WARN '} ${issue.message}`);
  }

  if (!assembly.legal) {
    lines.push('');
    lines.push('  cannot launch — no fight run.');
    return lines.join('\n');
  }

  if (verdict) {
    lines.push('');
    if (assembly.unplaced.length > 0) {
      // Fighting a wish that did not fit is worse than not fighting it: the
      // numbers look like a verdict on the part you named, and they are a
      // verdict on whatever fitted instead.
      const missing = assembly.unplaced.map((miss) => `${miss.wanted - miss.placed} x ${miss.partId}`).join(', ');
      lines.push(`  NOT THE BUILD YOU ASKED FOR — ${missing} never fitted. Read the score accordingly.`);
    }
    lines.push(`  vs the canonical roster — ${(verdict.overall * 100).toFixed(0)}% overall`);
    for (const matchup of [...verdict.matchups].sort((a, b) => b.winRate - a.winRate)) {
      const bar = '#'.repeat(Math.round(matchup.winRate * 20)).padEnd(20, '.');
      lines.push(`    ${matchup.templateId.padEnd(20)} ${bar} ${(matchup.winRate * 100).toFixed(0)}%`);
    }
    if (verdict.hardCounters.length > 0) lines.push(`    never beats: ${verdict.hardCounters.join(', ')}`);
    if (verdict.freeWins.length > 0) lines.push(`    never loses to: ${verdict.freeWins.join(', ')}`);
  }
  return lines.join('\n');
}
