import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  SPATIAL_DEMO_TEMPLATE,
  getChassis,
  resolvePlacementEffects,
  type Build,
} from '../src/index.js';

/**
 * A characterization fixture: every placement number every shipped template
 * produces, recorded before `resolvePlacementEffects` was rewired to read the
 * resolver.
 *
 * `buildEffects.test.ts` pins the two implementations against *each other*,
 * which is the right gate while there are two. The moment one delegates to the
 * other those assertions become tautologies and stop guarding anything -- so
 * the values are frozen here first, and this becomes the gate instead. A
 * migration that shifts a number fails on a named instance in a named template
 * rather than on a balance run three commits later.
 *
 * Regenerating this file to make it pass is the one thing that defeats its
 * purpose. If a value moves, either the rule changed on purpose (say so, and
 * re-record in its own commit) or something diverged.
 */
interface Row {
  partId: string;
  weaponRangeMultiplier: number;
  locationArcBonusDeg: number;
  locationHeatMultiplier: number;
  supportArcBonusDeg: number;
  armourHeatMultiplier: number;
  effectiveHeatMultiplier: number;
  baseWeaponArcDeg: number | null;
  effectiveWeaponArcDeg: number | null;
}

const expected = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/placementEffects.json', import.meta.url)),
  'utf8',
)) as Record<string, Record<string, Row>>;

function builds(): { name: string; build: Build }[] {
  return [
    { name: 'spatial-demo', build: structuredClone(SPATIAL_DEMO_TEMPLATE.build) },
    ...TEMPLATES.map((t) => ({ name: t.id, build: structuredClone(t.build) })),
  ];
}

describe('placement effects, frozen against the shipped templates', () => {
  it('covers every build and instance the fixture records', () => {
    expect(builds().map((b) => b.name).sort()).toEqual(Object.keys(expected).sort());
    // 69 instances across 8 builds, and every column has a non-neutral value
    // somewhere -- a fixture where everything is 1 would pass no matter what.
    expect(builds().reduce((n, b) => n + b.build.parts.length, 0)).toBe(69);
  });

  for (const key of [
    'weaponRangeMultiplier', 'locationArcBonusDeg', 'locationHeatMultiplier',
    'supportArcBonusDeg', 'armourHeatMultiplier', 'effectiveHeatMultiplier',
    'baseWeaponArcDeg', 'effectiveWeaponArcDeg',
  ] as const) {
    it(`is unmoved for ${key}`, () => {
      for (const { name, build } of builds()) {
        const chassis = getChassis(build.chassisId);
        for (const placed of build.parts) {
          const want = expected[name]?.[placed.instanceId];
          expect(want, `${name}/${placed.instanceId} missing from the fixture`).toBeDefined();
          const got = resolvePlacementEffects(chassis, build, placed.instanceId)!;
          const where = `${name}/${placed.instanceId} (${placed.partId})`;
          expect(want!.partId, where).toBe(placed.partId);

          const actual = key === 'locationArcBonusDeg' ? got.location.weaponArcBonusDeg
            : key === 'locationHeatMultiplier' ? got.location.heatMultiplier
              : got[key];
          if (want![key] === null || actual === null) expect(actual, where).toBe(want![key]);
          else expect(actual as number, where).toBeCloseTo(want![key] as number, 12);
        }
      }
    });
  }
});
