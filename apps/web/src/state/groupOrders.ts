import type { WeaponOverride } from '../components/BattleHud.js';

/** A group chip's standing order (MW spec §3). */
export type GroupState = 'auto' | 'hold' | 'fire';

export function cycleGroupState(s: GroupState): GroupState {
  return s === 'auto' ? 'hold' : s === 'hold' ? 'fire' : 'auto';
}

/**
 * Groups onto the per-gun override map the sim already takes. HOLD holds (and,
 * since a held gun loads and waits, readies a volley); FIRE forces; a per-gun
 * setting wins over its group.
 */
export function expandGroupOrders(
  groups: string[][], states: GroupState[], perGun: Record<string, WeaponOverride>,
): Record<string, WeaponOverride> {
  const out: Record<string, WeaponOverride> = {};
  groups.forEach((ids, g) => {
    const s = states[g] ?? 'auto';
    if (s === 'auto') return;
    for (const id of ids) out[id] = s === 'hold' ? 'hold' : 'force';
  });
  return { ...out, ...perGun };
}

/**
 * Everything back to auto except the Alpha counter. The sim ignores any token
 * not greater than the last it saw, so zeroing it would silently disarm Alpha
 * for the rest of the fight.
 */
export function resetToAuto<T extends { alpha: number }>(m: T, auto: Omit<T, 'alpha'>): T {
  return { ...auto, alpha: m.alpha } as T;
}
