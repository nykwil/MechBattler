/**
 * Build validation (docs/02 §2, docs/01 §9): the workshop's warning surface.
 * Philosophy is warn-only (docs/06 §6c): knowingly flawed builds stay legal
 * and fight; only physical impossibilities are errors. Every issue names its
 * consequence in plain language (rule R4/R8 -- no mystery failures).
 */
import type { Build, ChassisSpec } from './types.js';
import { getPart } from './catalog.js';
import { buildOccupancyMap, computeConnectivity, computeCoreNetwork, computeMassAndCoG, computePowerNetworks } from './grid.js';
import { averageDrawKw, computeCapacitorBank, computeEnergyMargin, computeHeatBalance, computeIdealRangeBand } from './derivedStats.js';
import { resolveSpatialPower, usesSpatialSystems } from './spatialPower.js';
import { validateWholeBuildPlacement } from './spatial.js';

export type IssueSeverity = 'error' | 'warn' | 'hint';

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
    | 'band-mismatch'
    | 'network-starved'
    | 'part-overheats'
    | 'part-runs-hot'
    | 'radiator-far'
    | 'ammo-cookoff-risk'
    | 'electrical-bottleneck'
    | 'illegal-placement'
    | 'illegal-route';
  message: string;
  /** Parts to highlight on the grid, when the issue is part-specific. */
  instanceIds: string[];
}

export function validateBuild(chassis: ChassisSpec, build: Build): BuildIssue[] {
  const issues: BuildIssue[] = [];
  // --- Errors: physical impossibilities -------------------------------------
  for (const physical of validateWholeBuildPlacement(chassis, build)) {
    issues.push({
      severity: 'error',
      code: physical.target === 'part' ? 'illegal-placement' : 'illegal-route',
      message: physical.target === 'part'
        ? `${physical.instanceId} is illegally fitted: ${physical.reason}`
        : `${physical.route?.kind ?? 'Route'} at ${physical.route?.regionId ?? 'body'}:${physical.route?.x},${physical.route?.y} is illegal: ${physical.reason}`,
      instanceIds: physical.instanceId ? [physical.instanceId] : [],
    });
  }
  if (build.parts.length === 0) return issues;
  const spatialPower = usesSpatialSystems(build) ? resolveSpatialPower(chassis, build) : null;
  const { connectedInstanceIds } = spatialPower ?? computeConnectivity(build.parts);
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
  if (hasReactor && (spatialPower ? spatialPower.coreNetworkId : computeCoreNetwork(chassis, build.parts)) === null) {
    issues.push({
      severity: 'error',
      code: 'core-unpowered',
      message: 'Core has no power path — locomotion is dead, the mech cannot move',
      instanceIds: [],
    });
  }

  // Cap-fed weapons need at least one capacitor on their own network (docs/02 §2).
  const { networks } = spatialPower ?? computePowerNetworks(build.parts);
  if (spatialPower && spatialPower.bottleneckInstanceIds.length > 0) {
    issues.push({
      severity: 'error',
      code: 'electrical-bottleneck',
      message: `Electrical bottleneck — ${spatialPower.bottleneckInstanceIds.map((id) => {
        const part = build.parts.find((candidate) => candidate.instanceId === id);
        return part ? getPart(part.partId).name.split(' ')[0] : id;
      }).join(', ')} demands more than its route can carry`,
      instanceIds: spatialPower.bottleneckInstanceIds,
    });
  }
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

  const mass = computeMassAndCoG(chassis, build.parts, build.routes);
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

  // Per-network starvation (docs/09 M3): the global margin pools all reactors,
  // so a split-network mistake — one reactor's island overloaded while another
  // idles — can look fine above. Only fires when the pooled margin is healthy;
  // otherwise the cannot-sustain-fire warning already covers it.
  if (margin.marginKw >= 0 && networks.length > 1) {
    for (const net of networks) {
      const supplyKw = net.reactorInstanceIds.reduce((s, id) => {
        const p = build.parts.find((mp) => mp.instanceId === id);
        return s + (p ? getPart(p.partId).reactor?.outputKw ?? 0 : 0);
      }, 0);
      const demandKw = net.memberInstanceIds.reduce((s, id) => {
        const p = build.parts.find((mp) => mp.instanceId === id);
        return s + (p ? averageDrawKw(getPart(p.partId)) : 0);
      }, 0);
      if (demandKw > supplyKw) {
        const consumers = net.memberInstanceIds.filter((id) => {
          const p = build.parts.find((mp) => mp.instanceId === id);
          return p && averageDrawKw(getPart(p.partId)) > 0;
        });
        issues.push({
          severity: 'warn',
          code: 'network-starved',
          message: `Power split: one reactor network supplies ${supplyKw.toFixed(0)} kW against ${demandKw.toFixed(1)} kW of demand while your other reactor${networks.length > 2 ? 's' : ''} can't reach it — bridge the networks with conduits or move a consumer`,
          instanceIds: consumers,
        });
      }
    }
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

/**
 * Heat advice (rule R5/R8: "build X so that Y"): prescriptive, per-part
 * guidance computed from the *predicted* cell temperatures (the workshop's
 * always-on 60 s sustained-fire prediction). Where validateBuild() names
 * global states, this names the specific hot part and the specific fix --
 * teaching the heat model through the build at hand: heat only moves between
 * touching parts, pipes move it 4x faster, radiators are the only exit.
 */
export function computeHeatAdvice(
  chassis: ChassisSpec,
  build: Build,
  cellTempsC: Record<string, number>,
): BuildIssue[] {
  void chassis;
  const issues: BuildIssue[] = [];
  if (build.parts.length === 0) return issues;

  const { cellsByInstance } = buildOccupancyMap(build.parts);
  const shortName = (partId: string) => getPart(partId).name.split(' (')[0]!;

  const radiatorCells: { x: number; y: number }[] = [];
  const pipeCells = new Set<string>();
  for (const p of build.parts) {
    const def = getPart(p.partId);
    const cells = cellsByInstance.get(p.instanceId) ?? [];
    if (def.id === 'U-RAD') radiatorCells.push(...cells);
    if (def.isHeatPipe) for (const c of cells) pipeCells.add(`${c.x},${c.y}`);
  }
  for (const route of build.routes ?? []) {
    if (route.kind === 'coolant') pipeCells.add(`${route.x},${route.y}`);
  }

  const peaks = build.parts
    .map((p) => {
      const cells = cellsByInstance.get(p.instanceId) ?? [];
      const peak = Math.max(0, ...cells.map((c) => cellTempsC[`${c.x},${c.y}`] ?? 0));
      return { p, cells, peak };
    })
    .sort((a, b) => b.peak - a.peak);

  let hotHints = 0;
  for (const { p, cells, peak } of peaks) {
    const def = getPart(p.partId);
    const name = shortName(p.partId);

    if (def.id === 'U-AMMO' && peak >= 140) {
      issues.push({
        severity: 'warn',
        code: 'ammo-cookoff-risk',
        message: `${name} trends to ~${Math.round(peak)}°C — at 180°C it cooks off (40 splash damage). Move it away from hot parts, or leave an empty cell beside it: air gaps don't conduct heat`,
        instanceIds: [p.instanceId],
      });
      continue;
    }
    if (def.id === 'U-RAD' || def.isHeatPipe || hotHints >= 2) continue;

    if (peak >= 130) {
      const touchesPipe = cells.some((c) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => pipeCells.has(`${c.x + dx!},${c.y + dy!}`)));
      const fix = radiatorCells.length === 0
        ? 'add a Gill radiator on a perimeter cell next to it — radiators are the only way heat leaves the mech'
        : touchesPipe
          ? 'its heat-pipe path or radiator cannot keep up — add another Gill near it'
          : 'run a heat-pipe route from it to your Gill so the heat drains instead of pooling (heat pipes conduct 4× faster than structure)';
      issues.push({
        severity: 'warn',
        code: 'part-overheats',
        message: `${name} reaches ~${Math.round(peak)}°C under sustained fire and will shut down at 130°C — ${fix}`,
        instanceIds: [p.instanceId],
      });
      hotHints++;
    } else if (peak >= 100) {
      issues.push({
        severity: 'hint',
        code: 'part-runs-hot',
        message: `${name} levels off around ${Math.round(peak)}°C — above the 100°C warning line. It works, but one hot-running salvage quirk or lost radiator tips it into shutdown; a heat-pipe route to a Gill buys margin`,
        instanceIds: [p.instanceId],
      });
      hotHints++;
    }
  }

  // Distance teaching: a radiator that heat can't reach is decoration.
  const hottest = peaks[0];
  if (hottest && hottest.peak >= 100 && radiatorCells.length > 0 && !getPart(hottest.p.partId).isHeatPipe) {
    const dist = Math.min(...hottest.cells.flatMap((c) =>
      radiatorCells.map((r) => Math.abs(c.x - r.x) + Math.abs(c.y - r.y))));
    const touchesPipe = hottest.cells.some((c) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => pipeCells.has(`${c.x + dx!},${c.y + dy!}`)));
    if (dist >= 3 && !touchesPipe) {
      issues.push({
        severity: 'hint',
        code: 'radiator-far',
        message: `Your nearest Gill is ${dist} cells from ${shortName(hottest.p.partId)} (your hottest part) — heat crawls through ordinary parts at 0.03 kW/°C, so it barely arrives. Bridge the gap with a heat-pipe route, or move the radiator next door`,
        instanceIds: [hottest.p.instanceId],
      });
    }
  }

  return issues;
}
