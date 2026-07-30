/** Surfaces reachable by `?view=`. */
export type DirectView = 'workshop' | 'balance' | 'battle' | 'report' | 'salvage';

/**
 * Views that must not ship. `salvage` calls startCustom, which overwrites the
 * persisted run — a player who followed that URL on the deployed site would lose
 * their campaign. `battle` and `report` are harmless but pointless in production,
 * and gating all three together keeps the rule easy to remember.
 */
export const DEV_ONLY_VIEWS: DirectView[] = ['battle', 'report', 'salvage'];

/**
 * Resolves `?view=` to a surface, dropping dev-only views outside development.
 * Pure, so the guard is testable without a browser or a production build.
 */
export function resolveView(requested: string | null, isDev: boolean): DirectView | null {
  if (!requested) return null;
  const view = requested as DirectView;
  if (!isDev && DEV_ONLY_VIEWS.includes(view)) return null;
  return view;
}
