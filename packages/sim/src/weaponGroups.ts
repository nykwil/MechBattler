import { getPart } from './catalog.js';
import type { Build } from './types.js';

/** Group chips on the live console (MW spec §2). */
export const MAX_WEAPON_GROUPS = 3;

function weaponParts(build: Build) {
  return build.parts.filter((p) => getPart(p.partId).category === 'weapon');
}

/**
 * Long guns in G1, short guns in G2, G3 empty. "Long" is idealMax at or above
 * the build's upper median, so two guns of different reach always split, and
 * guns of equal reach stay together in G1.
 */
export function defaultWeaponGroups(build: Build): string[][] {
  const guns = weaponParts(build);
  if (guns.length === 0) return [[], [], []];
  const reach = (partId: string) => getPart(partId).weapon!.falloff.idealMax;
  const sorted = guns.map((p) => reach(p.partId)).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return [
    guns.filter((p) => reach(p.partId) >= median).map((p) => p.instanceId),
    guns.filter((p) => reach(p.partId) < median).map((p) => p.instanceId),
    [],
  ];
}

/** The build's groups, read safely: live weapon ids only, each at most once, always three lists. */
export function normaliseWeaponGroups(build: Build): string[][] {
  if (!build.weaponGroups) return defaultWeaponGroups(build);
  const live = new Set(weaponParts(build).map((p) => p.instanceId));
  const seen = new Set<string>();
  const out: string[][] = [];
  for (let i = 0; i < MAX_WEAPON_GROUPS; i++) {
    out.push((build.weaponGroups[i] ?? []).filter((id) => {
      if (!live.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }));
  }
  return out;
}
