import {
  BRANCH_PROBE_TEMPLATES, CHASSIS, MODIFIERS, ModBuilder, PARTS, TEMPLATES, validateBuild,
  type ModifierCtx, type ScalableField,
} from '@mechbattler/sim';
import { GAME_CONTENT, getGameplayTemplate } from './content.js';
import { defaultProfile, savedMechErrors } from './persistence.js';
import { ENEMY_FIELDABLE_PART_IDS } from './nodes.js';

export interface GameAudit {
  ok: boolean;
  errors: string[];
  counts: {
    enabledParts: number;
    enabledChassis: number;
    initialParts: number;
    challenges: number;
    starterKits: number;
  };
  economy: typeof GAME_CONTENT.economy;
  run: typeof GAME_CONTENT.run;
  unlockGraph: {
    initialPartIds: string[];
    challenges: Array<{ challengeId: string; partIds: string[] }>;
  };
  acquisitionReachability: Array<{
    partId: string;
    startingRoute: string;
    runRoutes: string[];
  }>;
  starterLegality: Array<{
    templateId: string;
    legal: boolean;
    chassisId?: string;
    requiredPartIds: string[];
    errors: string[];
  }>;
  defaultGarage: Array<{
    id: string;
    name: string;
    chassisId: string;
    legal: boolean;
    errors: string[];
  }>;
  challengeDefinitions: typeof GAME_CONTENT.challenges;
  diagnostics: {
    impossibleContent: string[];
    selfDependentContent: string[];
    /**
     * Fields where the modifiers a single part can legally carry could sum to a
     * 100% reduction or worse. `ModBuilder` clamps at zero so this can never
     * invert an effect at runtime, but a clamp firing means the catalog is
     * wrong — the additive pool is meant to make sources compete, not cancel.
     */
    saturatedAdditivePools: string[];
  };
}

/**
 * Contexts that reach every branch a modifier can take: cold and hot, still and
 * moving, and each terrain that anything reads. A modifier's worst additive
 * contribution is its most negative across these.
 */
const AUDIT_CTXS: ModifierCtx[] = [
  { tempC: 20, speedMps: 0, tile: 'open' },
  { tempC: 20, speedMps: 6, tile: 'water' },
  { tempC: 120, speedMps: 0, tile: 'forest' },
  { tempC: 120, speedMps: 6, tile: 'hill' },
];

/**
 * Worst-case additive pool per field, per part.
 *
 * Probes each applicable modifier rather than reading its source: run `apply`
 * against a builder and ask what it put in the additive pool. Copies of one
 * modifier are limited per build, so the worst case is one of each applicable
 * modifier stacked on the same part.
 */
function saturatedAdditivePools(): string[] {
  const offenders: string[] = [];
  for (const def of Object.values(PARTS)) {
    const totals = new Map<ScalableField, number>();
    for (const modifier of Object.values(MODIFIERS)) {
      if (!modifier.appliesTo(def)) continue;
      const worst = new Map<ScalableField, number>();
      for (const ctx of AUDIT_CTXS) {
        const probe = new ModBuilder();
        modifier.apply(probe, ctx, def);
        for (const [field, delta] of Object.entries(probe.peekAdditive())) {
          const key = field as ScalableField;
          worst.set(key, Math.min(worst.get(key) ?? 0, delta ?? 0));
        }
      }
      for (const [field, delta] of worst) {
        if (delta < 0) totals.set(field, (totals.get(field) ?? 0) + delta);
      }
    }
    for (const [field, total] of totals) {
      if (1 + total <= 0) {
        offenders.push(
          `${def.id}: additive pool for ${field} can reach ${(1 + total).toFixed(2)} `
          + '(a 100% reduction or worse) — split a source into the multiplicative bucket',
        );
      }
    }
  }
  return offenders;
}

export function auditGameContent(): GameAudit {
  const errors: string[] = [];
  const saturated = saturatedAdditivePools();
  errors.push(...saturated);
  const starterLegality: GameAudit['starterLegality'] = [];
  // What opponents can actually field, derived from the doctrine table rather
  // than from "everything enabled" — see ENEMY_FIELDABLE_PART_IDS.
  const enemyPartIds = new Set([
    ...TEMPLATES.flatMap((template) => template.build.parts.map((part) => part.partId)),
    ...ENEMY_FIELDABLE_PART_IDS,
  ]);
  const enabledChassis = new Set(GAME_CONTENT.enabledChassisIds);
  const catalogChassis = Object.keys(CHASSIS);
  if (enabledChassis.size !== GAME_CONTENT.enabledChassisIds.length) {
    errors.push('Enabled chassis ids must be unique');
  }
  for (const id of catalogChassis) if (!enabledChassis.has(id)) errors.push(`Catalog chassis ${id} is not enabled`);
  for (const id of enabledChassis) if (!CHASSIS[id]) errors.push(`Enabled chassis ${id} is missing from the sim catalog`);
  for (const id of GAME_CONTENT.initialChassisIds) {
    if (!enabledChassis.has(id)) errors.push(`Initial chassis ${id} is not enabled`);
  }
  const oneHour = GAME_CONTENT.progressionTargets.oneHour;
  if (oneHour.battleCount !== 8) errors.push('One-hour target must use the eight-battle proxy');
  if (new Set(oneHour.chassisIds).size !== oneHour.chassisIds.length) errors.push('One-hour chassis ids must be unique');
  if (new Set(oneHour.partIds).size !== oneHour.partIds.length) errors.push('One-hour part ids must be unique');
  for (const id of enabledChassis) if (!oneHour.chassisIds.includes(id)) errors.push(`One-hour target is missing chassis ${id}`);
  for (const id of oneHour.partIds) if (!GAME_CONTENT.enabledPartIds.includes(id)) errors.push(`One-hour target has disabled part ${id}`);
  for (const id of enabledChassis) {
    const probes = BRANCH_PROBE_TEMPLATES.filter((template) => template.build.chassisId === id);
    if (probes.length !== 3) errors.push(`Chassis ${id} has ${probes.length} one-hour branch probes; expected 3`);
    for (const probe of probes) {
      for (const part of probe.build.parts) {
        if (!oneHour.partIds.includes(part.partId)) errors.push(`Branch probe ${probe.id} uses post-one-hour part ${part.partId}`);
      }
    }
  }
  if (GAME_CONTENT.run.balanceCheckpointDepths.some(
    (depth) => !Number.isInteger(depth) || depth < 1 || depth > GAME_CONTENT.run.length,
  )) {
    errors.push('Balance checkpoint depths must be integer nodes within the run');
  }
  if (new Set(GAME_CONTENT.run.balanceCheckpointDepths).size
    !== GAME_CONTENT.run.balanceCheckpointDepths.length) {
    errors.push('Balance checkpoint depths must be unique');
  }
  if (GAME_CONTENT.run.balanceTargetWinRateMin < 0
    || GAME_CONTENT.run.balanceTargetWinRateMax > 1
    || GAME_CONTENT.run.balanceTargetWinRateMin >= GAME_CONTENT.run.balanceTargetWinRateMax) {
    errors.push('Balance target win-rate band is invalid');
  }
  const enabled = new Set(GAME_CONTENT.enabledPartIds);
  const routed = new Map<string, string[]>();
  for (const id of GAME_CONTENT.initialPartIds) {
    if (!enabled.has(id)) errors.push(`Initial part ${id} is not enabled`);
    routed.set(id, [...(routed.get(id) ?? []), 'initial']);
  }
  for (const challenge of GAME_CONTENT.challenges) {
    for (const id of challenge.unlockPartIds) {
      if (!enabled.has(id)) errors.push(`Challenge ${challenge.id} unlocks disabled/unknown part ${id}`);
      routed.set(id, [...(routed.get(id) ?? []), challenge.id]);
    }
  }
  for (const id of enabled) {
    if (!PARTS[id]) errors.push(`Enabled part ${id} is missing from the sim catalog`);
    const routes = routed.get(id) ?? [];
    if (routes.length !== 1) errors.push(`${id} has ${routes.length} starting unlock routes (${routes.join(', ')})`);
    if (!GAME_CONTENT.scrapyardPartIds.includes(id) && !PARTS[id]?.isConduit && !PARTS[id]?.isHeatPipe) {
      errors.push(`${id} has no in-run scrapyard acquisition route`);
    }
  }
  if (enabled.has('U-AMMO')) errors.push('U-AMMO must remain disabled until ammunition is functional');
  for (const kit of GAME_CONTENT.starterKits) {
    const template = getGameplayTemplate(kit.templateId);
    if (!template) {
      errors.push(`Starter kit ${kit.templateId} is missing`);
      starterLegality.push({
        templateId: kit.templateId,
        legal: false,
        requiredPartIds: [],
        errors: ['Template is missing'],
      });
      continue;
    }
    const kitErrors: string[] = [];
    const chassis = CHASSIS[template.build.chassisId];
    if (!chassis) {
      const message = `Starter kit ${kit.templateId} has unknown chassis`;
      errors.push(message);
      kitErrors.push(message);
    }
    else for (const issue of validateBuild(chassis, template.build).filter((issue) => issue.severity === 'error')) {
      const message = `Starter kit ${kit.templateId}: ${issue.message}`;
      errors.push(message);
      kitErrors.push(message);
    }
    for (const part of template.build.parts) {
      if (part.partId === 'U-AMMO') {
        const message = `Starter kit ${kit.templateId} exposes disabled U-AMMO`;
        errors.push(message);
        kitErrors.push(message);
      }
    }
    starterLegality.push({
      templateId: kit.templateId,
      legal: kitErrors.length === 0,
      chassisId: template.build.chassisId,
      requiredPartIds: [...new Set(template.build.parts.map((part) => part.partId))].sort(),
      errors: kitErrors,
    });
  }
  const acquisitionReachability = [...enabled].sort().map((partId) => {
    const startingRoutes = routed.get(partId) ?? [];
    return {
      partId,
      startingRoute: startingRoutes[0] ?? 'missing',
      runRoutes: [
        ...(GAME_CONTENT.scrapyardPartIds.includes(partId) ? ['scrapyard'] : []),
        ...(enemyPartIds.has(partId) ? ['enemy-salvage'] : []),
      ],
    };
  });
  const defaultGarageProfile = defaultProfile();
  const defaultGarage = defaultGarageProfile.savedMechs.map((savedMech) => {
    const garageErrors = savedMechErrors(defaultGarageProfile, savedMech.build);
    for (const message of garageErrors) errors.push(`Default saved mech ${savedMech.id}: ${message}`);
    return {
      id: savedMech.id,
      name: savedMech.name,
      chassisId: savedMech.build.chassisId,
      legal: garageErrors.length === 0,
      errors: garageErrors,
    };
  });
  if (defaultGarage.length === 0) errors.push('Fresh profiles have no legal saved mech');
  return {
    ok: errors.length === 0,
    errors,
    counts: {
      enabledParts: GAME_CONTENT.enabledPartIds.length,
      enabledChassis: GAME_CONTENT.enabledChassisIds.length,
      initialParts: GAME_CONTENT.initialPartIds.length,
      challenges: GAME_CONTENT.challenges.length,
      starterKits: GAME_CONTENT.starterKits.length,
    },
    economy: GAME_CONTENT.economy,
    run: GAME_CONTENT.run,
    unlockGraph: {
      initialPartIds: [...GAME_CONTENT.initialPartIds],
      challenges: GAME_CONTENT.challenges.map((challenge) => ({
        challengeId: challenge.id,
        partIds: challenge.unlockPartIds,
      })),
    },
    acquisitionReachability,
    starterLegality,
    defaultGarage,
    challengeDefinitions: GAME_CONTENT.challenges,
    diagnostics: {
      impossibleContent: [...errors],
      // Predicate data currently names outcome facts, never its own reward ids.
      selfDependentContent: [],
      saturatedAdditivePools: saturated,
    },
  };
}
