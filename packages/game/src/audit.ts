import { CHASSIS, PARTS, TEMPLATES, validateBuild } from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import { defaultProfile, savedMechErrors } from './persistence.js';

export interface GameAudit {
  ok: boolean;
  errors: string[];
  counts: {
    enabledParts: number;
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
  };
}

export function auditGameContent(): GameAudit {
  const errors: string[] = [];
  const starterLegality: GameAudit['starterLegality'] = [];
  const enemyPartIds = new Set([
    ...TEMPLATES.flatMap((template) => template.build.parts.map((part) => part.partId)),
    ...GAME_CONTENT.enemyFillPartIds,
  ]);
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
  if (GAME_CONTENT.economy.chassisRecoveryBaseCost < 0
    || GAME_CONTENT.economy.chassisRecoveryPerCell <= 0) {
    errors.push('Chassis recovery costs must be non-negative with a positive per-cell rate');
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
    const template = TEMPLATES.find((candidate) => candidate.id === kit.templateId);
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
    },
  };
}
