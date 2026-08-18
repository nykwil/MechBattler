import { describe, expect, it } from 'vitest';
import {
  CHASSIS_IDENTITIES,
  PERK_CASES,
  PERK_TEMPLATES,
  auditFittingFreedom,
  auditPartDifferentiation,
} from '../src/diversity.js';
import { auditModifierLoadout } from '../src/modifiers.js';
import { computeSpeedProfile } from '../src/derivedStats.js';
import { computeLoadScaledSpeeds, computeMassAndCoG } from '../src/grid.js';
import { resolveSpeedMultiplier } from '../src/buildEffects.js';
import { getChassis } from '../src/chassis.js';
import { validateWholeBuildPlacement } from '../src/spatial.js';

describe('build diversity and perk guardrails', () => {
  it('every chassis has at least two coherent named identities', () => {
    for (const [chassisId, identities] of Object.entries(CHASSIS_IDENTITIES)) {
      expect(identities.length, chassisId).toBeGreaterThanOrEqual(2);
      expect(new Set(identities).size, chassisId).toBe(identities.length);
    }
  });

  it('small chassis retain fitting choices after their mandatory kernels', () => {
    const vultures = auditFittingFreedom().filter((entry) => entry.chassisId === 'CH-2');
    expect(vultures.length).toBeGreaterThanOrEqual(3);
    for (const entry of vultures) {
      expect(entry.fittingCapacity, entry.id).toBeGreaterThanOrEqual(8);
      expect(entry.freeCells, entry.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('accepted representative perk builds obey one-mod and copy limits', () => {
    expect(PERK_TEMPLATES).toHaveLength(4);
    for (const perkCase of PERK_CASES) expect(auditModifierLoadout(perkCase.perk)).toEqual([]);
  });

  it('accepted perk probes remain legal regional builds', () => {
    for (const template of PERK_TEMPLATES) {
      expect(validateWholeBuildPlacement(getChassis(template.build.chassisId), template.build), template.id)
        .toEqual([]);
    }
  });

  it('rejects duplicate high-leverage perk copies as a stacking loop', () => {
    const fever = PERK_CASES.find((entry) => entry.perkId === 'fever-cycle')!;
    const stacked = {
      ...fever.perk,
      parts: fever.perk.parts.map((part) => part.instanceId === 'las2'
        ? { ...part, modifiers: ['fever-cycle'] }
        : part),
    };
    expect(auditModifierLoadout(stacked).map((issue) => issue.kind)).toContain('copy-limit');
  });

  it('Stride provides exactly one capped 15% speed boost after its mass cost', () => {
    const build = PERK_CASES.find((entry) => entry.perkId === 'hull-down')!.control;
    const chassis = getChassis(build.chassisId);
    const base = computeLoadScaledSpeeds(chassis, computeMassAndCoG(chassis, build.parts));
    const profile = computeSpeedProfile(chassis, build);
    expect(profile.fwd).toBeCloseTo(base.fwd * 1.15);
    expect(profile.strafe).toBeCloseTo(base.strafe * 1.15);
    expect(profile.rev).toBeCloseTo(base.rev * 1.15);
    const stride = build.parts.find((part) => part.partId === 'U-ACT')!;
    expect(resolveSpeedMultiplier(
      [...build.parts, { ...stride, instanceId: 'redundant-stride' }], () => true,
    )).toBe(1.15);
  });

  it('part overlap audit exposes the known ammo placeholder', () => {
    const findings = auditPartDifferentiation();
    expect(findings.some((finding) => finding.parts === 'U-AMMO' && finding.verdict === 'dead-placeholder')).toBe(true);
    expect(findings.filter((finding) => finding.verdict === 'distinct').length).toBeGreaterThanOrEqual(5);
  });

});
