/**
 * Build validation (docs/02 §2, docs/01 §9): the workshop's warning surface.
 * Philosophy is warn-only (docs/06 §6c): knowingly flawed builds stay legal
 * and fight; only physical impossibilities are errors. Every issue names its
 * consequence in plain language (rule R4/R8 -- no mystery failures).
 */
import type { Build, ChassisSpec } from './types.js';
import { getPart } from './catalog.js';
import { computeConnectivity, computeCoreNetwork, computeMassAndCoG, computePowerNetworks } from './grid.js';
import { computeCapacitorBank, computeEnergyMargin, computeHeatBalance, computeIdealRangeBand } from './derivedStats.js';

export type IssueSeverity = 'error' | 'warn';

export interface BuildIssue {
  severity: IssueSeverity;
  code:
    | 'unpowered-parts'
    | 'core-unpowered'
    | 'cap-starved-weapon'
    | 'cannot-sustain-fire'
    | 'overheats'
    | 'overloaded'
    | 'no-weapons'
    | 'band-mismatch';
  message: string;
  /** Parts to highlight on the grid, when the issue is part-specific. */
  instanceIds: string[];
}

export function validateBuild(chassis: ChassisSpec, build: Build): BuildIssue[] {
  const issues: BuildIssue[] = [];
  if (build.parts.length === 0) return issues;

  // --- Errors: physical impossibilities -------------------------------------
  const { connectedInstanceIds } = computeConnectivity(build.parts);
  const unpowered = build.parts.filter((p) => {
    const def = getPart(p.partId);
    const needsPower = Boolean(def.draw) || def.category === 'weapon' || def.category === 'capacitor';
    return needsPower && !connectedInstanceIds.has(p.instanceId);
  });
  if (unpowered.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unpowered-parts',
      message: `${unpowered.length} part${unpowered.length > 1 ? 's have' : ' has'} no power path — ${unpowered.map((p) => getPart(p.partId).name.split(' ')[0]).join(', ')} will do nothing`,
      instanceIds: unpowered.map((p) => p.instanceId),
    });
  }

  const hasReactor = build.parts.some((p) => getPart(p.partId).category === 'reactor');
  if (hasReactor && computeCoreNetwork(chassis, build.parts) === null) {
    issues.push({
      severity: 'error',
      code: 'core-unpowered',
      message: 'Core has no power path — locomotion is dead, the mech cannot move',
      instanceIds: [],
    });
  }

  // Cap-fed weapons need at least one capacitor on their own network (docs/02 §2).
  const { networks } = computePowerNetworks(build.parts);
  const capStarved = build.parts.filter((p) => {
    const def = getPart(p.partId);
    if (!def.draw?.capFedEnergyPerShotKj) return false;
    const net = networks.find((n) => n.memberInstanceIds.includes(p.instanceId));
    if (!net) return false; // already reported as unpowered
    return !net.memberInstanceIds.some((id) => {
      const member = build.parts.find((mp) => mp.instanceId === id);
      return member && getPart(member.partId).category === 'capacitor';
    });
  });
  if (capStarved.length > 0) {
    issues.push({
      severity: 'error',
      code: 'cap-starved-weapon',
      message: `${capStarved.map((p) => getPart(p.partId).name.split(' ')[0]).join(', ')} is capacitor-fed but its network has no capacitors — it can never fire`,
      instanceIds: capStarved.map((p) => p.instanceId),
    });
  }

  // --- Warnings: legal but consequential ------------------------------------
  const margin = computeEnergyMargin(chassis, build);
  if (margin.marginKw < 0) {
    const caps = computeCapacitorBank(build);
    const suffix = caps.storedKj > 0
      ? `full capacitors sustain it for ~${(caps.storedKj / -margin.marginKw).toFixed(0)}s, then brownout`
      : 'no capacitors — parts brown out immediately, lowest priority first';
    issues.push({
      severity: 'warn',
      code: 'cannot-sustain-fire',
      message: `CANNOT SUSTAIN FIRE — demand exceeds supply by ${(-margin.marginKw).toFixed(1)} kW; ${suffix}`,
      instanceIds: [],
    });
  }

  const heat = computeHeatBalance(chassis, build);
  if (heat.heatInKw > 0 && heat.marginKw < 0) {
    issues.push({
      severity: 'warn',
      code: 'overheats',
      message: `Heat exceeds cooling capacity by ${(-heat.marginKw).toFixed(1)} kW — sustained fire will overheat (check the thermal overlay for where)`,
      instanceIds: [],
    });
  }

  const mass = computeMassAndCoG(chassis, build.parts);
  if (mass.totalMassT > chassis.ratedMassT) {
    const loadPct = Math.round((mass.totalMassT / chassis.ratedMassT) * 100);
    issues.push({
      severity: 'warn',
      code: 'overloaded',
      message: `Overloaded: ${mass.totalMassT.toFixed(1)}t on a ${chassis.ratedMassT.toFixed(1)}t chassis (${loadPct}%) — all speeds and turn rate degrade`,
      instanceIds: [],
    });
  }

  const hasWeapon = build.parts.some((p) => getPart(p.partId).category === 'weapon');
  if (!hasWeapon) {
    issues.push({
      severity: 'warn',
      code: 'no-weapons',
      message: 'No weapons mounted — the mech surrenders by mission-kill 3 s into any fight',
      instanceIds: [],
    });
  }

  const band = computeIdealRangeBand(build);
  if (band.mismatched) {
    issues.push({
      severity: 'warn',
      code: 'band-mismatch',
      message: 'Weapon envelopes are disjoint — the autopilot cannot pick a range that suits all guns',
      instanceIds: band.perWeapon.map((w) => w.instanceId),
    });
  }

  return issues;
}
