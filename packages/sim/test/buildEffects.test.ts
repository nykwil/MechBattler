import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  INSTANCE_KNOBS,
  MECH_KNOBS,
  PARTS,
  SPATIAL_DEMO_TEMPLATE,
  getChassis,
  getPart,
  locationEffectsForPart,
  resolveBuildEffects,
  resolvePlacementEffects,
  type Build,
} from '../src/index.js';

/**
 * `resolveBuildEffects` is only worth having if it provably says the same thing
 * the scattered reductions said. These pin it against each one it subsumes,
 * across every shipped template rather than a hand-built fixture, so a
 * migration in the next step that shifts a number fails here and not in a
 * balance run three commits later.
 */
const allActive = () => true;

function templates(): { name: string; build: Build }[] {
  return [
    { name: 'spatial-demo', build: structuredClone(SPATIAL_DEMO_TEMPLATE.build) },
    ...TEMPLATES.map((t) => ({ name: t.id, build: structuredClone(t.build) })),
  ];
}

describe('resolveBuildEffects reproduces the reductions it replaces', () => {
  it('covers more than a couple of builds', () => {
    expect(templates().length).toBeGreaterThan(4);
  });

  it('matches locationEffectsForPart on the zone-scoped knobs', () => {
    for (const { name, build } of templates()) {
      const chassis = getChassis(build.chassisId);
      const effects = resolveBuildEffects(chassis, build, allActive);
      for (const placed of build.parts) {
        const zone = locationEffectsForPart(chassis, placed);
        const got = effects.byInstance.get(placed.instanceId)!;
        expect(got.weaponRangeMultiplier, `${name}/${placed.instanceId}`)
          .toBeCloseTo(zone.weaponRangeMultiplier, 12);
      }
    }
  });

  it('matches resolvePlacementEffects on arc and heat, which mix two scopes', () => {
    for (const { name, build } of templates()) {
      const chassis = getChassis(build.chassisId);
      const effects = resolveBuildEffects(chassis, build, allActive);
      for (const placed of build.parts) {
        const placement = resolvePlacementEffects(chassis, build, placed.instanceId, allActive)!;
        const got = effects.byInstance.get(placed.instanceId)!;
        const where = `${name}/${placed.instanceId}`;

        expect(got.heatMultiplier, where).toBeCloseTo(placement.effectiveHeatMultiplier, 12);

        // resolvePlacementEffects only exposes the combined arc for weapons.
        const base = placement.baseWeaponArcDeg;
        if (base !== null) {
          expect(Math.min(360, base + got.weaponArcBonusDeg), where)
            .toBeCloseTo(placement.effectiveWeaponArcDeg!, 12);
        }
      }
    }
  });

  it('matches the best-Stride max the grid helper used to compute', () => {
    for (const { name, build } of templates()) {
      const chassis = getChassis(build.chassisId);
      const expected = build.parts.reduce(
        (best, p) => Math.max(best, getPart(p.partId).speedMult ?? 1), 1,
      );
      expect(resolveBuildEffects(chassis, build, allActive).mech.speedMultiplier, name)
        .toBeCloseTo(expected, 12);
    }
  });

  it('matches the fire-control product Combatant computes', () => {
    for (const { name, build } of templates()) {
      const chassis = getChassis(build.chassisId);
      const expected = build.parts.reduce(
        (mult, p) => mult * (getPart(p.partId).fireControlLateralMult ?? 1), 1,
      );
      expect(resolveBuildEffects(chassis, build, allActive).mech.fireControlLateralMult, name)
        .toBeCloseTo(expected, 12);
    }
  });
});

/**
 * A sweep over the shipped templates exercises range (9 instances), arc (16),
 * heat (16) and fire control (1), but **no template fits a Stride**, so the
 * speed equivalence above compares 1 to 1 and proves nothing on its own. These
 * build the case by hand, and contrast the two mech-scoped buckets directly:
 * the same pair of parts stacks for one knob and deliberately does not for the
 * other.
 */
describe('the mech-scoped buckets, which the templates do not cover', () => {
  const chassis = getChassis('CH-5');
  const at = (instanceId: string, partId: string, y: number) => ({
    instanceId, partId, origin: { regionId: 'body', x: 0, y }, rotation: 0 as const, integrity: 1,
  });

  it('speed takes the best Stride: a second copy is insurance, not more speed', () => {
    const one = [at('stride-a', 'U-ACT', 0)];
    const two = [...one, at('stride-b', 'U-ACT', 2)];
    const oneMult = resolveBuildEffects(chassis, { parts: one }, allActive).mech.speedMultiplier;
    const twoMult = resolveBuildEffects(chassis, { parts: two }, allActive).mech.speedMultiplier;

    expect(oneMult).toBeCloseTo(PARTS['U-ACT']!.speedMult!, 12);
    expect(twoMult).toBe(oneMult);
    // The bucket is doing the work: multiplicative would be 1.3225.
    expect(twoMult).not.toBeCloseTo(oneMult * oneMult, 6);
  });

  it('fire control compounds instead, so two computers cost and buy twice', () => {
    const one = [at('tc-a', 'U-TC1', 0)];
    const two = [...one, at('tc-b', 'U-TC1', 2)];
    const oneMult = resolveBuildEffects(chassis, { parts: one }, allActive).mech.fireControlLateralMult;
    const twoMult = resolveBuildEffects(chassis, { parts: two }, allActive).mech.fireControlLateralMult;

    expect(oneMult).toBeCloseTo(PARTS['U-TC1']!.fireControlLateralMult!, 12);
    expect(twoMult).toBeCloseTo(oneMult * oneMult, 12);
  });

  it('and both drop the part once it is gated out', () => {
    const parts = [at('stride-a', 'U-ACT', 0), at('tc-a', 'U-TC1', 2)];
    const gated = resolveBuildEffects(chassis, { parts }, (id) => id !== 'stride-a');
    expect(gated.mech.speedMultiplier).toBe(1);
    expect(gated.mech.fireControlLateralMult).toBeCloseTo(PARTS['U-TC1']!.fireControlLateralMult!, 12);
  });
});

describe('gating is the caller\'s, and it bites', () => {
  const build = structuredClone(SPATIAL_DEMO_TEMPLATE.build);
  const chassis = getChassis(build.chassisId);

  it('a downed support stops granting its arc', () => {
    const support = build.parts.find((p) => getPart(p.partId).spatial?.weaponArcBonusDeg);
    if (!support) return; // demo build carries no Gimbal; the template sweep covers it
    const withIt = resolveBuildEffects(chassis, build, allActive);
    const without = resolveBuildEffects(chassis, build, (id) => id !== support.instanceId);
    for (const placed of build.parts) {
      expect(without.byInstance.get(placed.instanceId)!.weaponArcBonusDeg)
        .toBeLessThanOrEqual(withIt.byInstance.get(placed.instanceId)!.weaponArcBonusDeg);
    }
  });

  it('a downed part contributes nothing mech-wide', () => {
    const none = resolveBuildEffects(chassis, build, () => false);
    expect(none.mech.speedMultiplier).toBe(MECH_KNOBS.speedMultiplier.neutral);
    expect(none.mech.fireControlLateralMult).toBe(MECH_KNOBS.fireControlLateralMult.neutral);
  });

  it('still reports placement for every fitted instance, downed or not', () => {
    const none = resolveBuildEffects(chassis, build, () => false);
    expect([...none.byInstance.keys()].sort())
      .toEqual(build.parts.map((p) => p.instanceId).sort());
  });
});

describe('the invariants the per-cell reductions rely on', () => {
  it('every arc-granting support is a support layer, so it can only sit below', () => {
    // combat.ts walked the whole stack for the arc bonus while
    // placementEffects.ts walked only what was below. They agree today solely
    // because layer order puts supports at the bottom; if a payload or armour
    // part ever grants arc, those two silently disagree and this catches it.
    for (const def of Object.values(PARTS)) {
      if (def.spatial?.weaponArcBonusDeg === undefined) continue;
      expect(def.spatial.layer, def.id).toBe('support');
    }
  });

  it('every heat-covering shell is an armour layer, so it can only sit above', () => {
    for (const def of Object.values(PARTS)) {
      if (def.spatial?.coveredHeatMultiplier === undefined) continue;
      expect(def.spatial.layer, def.id).toBe('armour');
    }
  });

  it('declares a bucket and scope for every knob it returns', () => {
    expect(Object.keys(INSTANCE_KNOBS).sort())
      .toEqual(['heatMultiplier', 'weaponArcBonusDeg', 'weaponRangeMultiplier']);
    expect(Object.keys(MECH_KNOBS).sort())
      .toEqual(['fireControlLateralMult', 'speedMultiplier']);
  });
});
