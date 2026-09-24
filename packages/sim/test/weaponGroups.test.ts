import { describe, expect, it } from 'vitest';
import { defaultWeaponGroups, normaliseWeaponGroups, MAX_WEAPON_GROUPS } from '../src/weaponGroups.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';
import type { Build } from '../src/types.js';

const guns = (b: Build) => b.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);

describe('weapon groups (MW spec §2)', () => {
  it('defaults every gun into exactly one of three groups, long reach first', () => {
    for (const t of TEMPLATES) {
      const g = defaultWeaponGroups(t.build);
      expect(g).toHaveLength(MAX_WEAPON_GROUPS);
      expect(g.flat().sort()).toEqual(guns(t.build).sort());
      expect(g[2]).toEqual([]);
      const reach = (id: string) => getPart(t.build.parts.find((p) => p.instanceId === id)!.partId).weapon!.falloff.idealMax;
      for (const long of g[0]!) for (const short of g[1]!) expect(reach(long)).toBeGreaterThan(reach(short));
    }
  });

  it('a build with no guns gets three empty groups', () => {
    expect(defaultWeaponGroups({ chassisId: 'CH-5', parts: [], powerPriority: [] })).toEqual([[], [], []]);
  });

  it('drops ids that are no longer guns on the build, and duplicates (Review Focus 3)', () => {
    const b = TEMPLATES[0]!.build;
    const [first] = guns(b);
    const g = normaliseWeaponGroups({ ...b, weaponGroups: [[first!, 'gone'], [first!], ['also-gone']] });
    expect(g).toEqual([[first], [], []]);
  });

  it('pads short lists and ignores a fourth group', () => {
    const b = TEMPLATES[0]!.build;
    const ids = guns(b);
    expect(normaliseWeaponGroups({ ...b, weaponGroups: [[ids[0]!]] })).toHaveLength(3);
    expect(normaliseWeaponGroups({ ...b, weaponGroups: [[], [], [], [ids[0]!]] }).flat()).toEqual([]);
  });
});
