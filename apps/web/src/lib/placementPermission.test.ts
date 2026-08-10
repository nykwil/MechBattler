import { describe, expect, it } from 'vitest';
import type { Build } from '@mechbattler/sim';
import { placementPermission } from './placementPermission.js';
import { START_BUDGET } from '../state/runState.js';

const empty: Build = { chassisId: 'CH-5', parts: [], powerPriority: [] };
/** Tier-3 weapons, enough to sit at or over the prep budget. */
const heavy: Build = {
  chassisId: 'CH-5',
  parts: Array.from({ length: 6 }, (_, i) => ({
    instanceId: `w${i}`, partId: 'W-RG', origin: { x: i % 3, y: Math.floor(i / 3) },
    rotation: 0 as const, integrity: 1,
  })),
  powerPriority: [],
};

const ask = (over: Partial<Parameters<typeof placementPermission>[0]> = {}) =>
  placementPermission({ partId: 'W-AC', build: empty, phase: 'none', pendingBench: null, ...over });

describe('placementPermission', () => {
  it('allows anything in the sandbox', () => {
    expect(ask({ phase: 'none' })).toEqual({ kind: 'allow' });
  });

  it('refuses the catalog once a run is live', () => {
    // Otherwise the catalog is a scrap printer: buy, sell, repeat.
    expect(ask({ phase: 'active' })).toEqual({ kind: 'deny', reason: 'run-is-reference-only' });
  });

  it('still allows owned bench salvage during a live run', () => {
    expect(ask({ phase: 'active', pendingBench: { index: 2, partId: 'W-AC' } }))
      .toEqual({ kind: 'allow-from-bench', benchIndex: 2 });
  });

  it('only matches a bench part against the armed part', () => {
    // A stale bench selection must not smuggle in a different catalog part.
    expect(ask({ phase: 'active', partId: 'W-AC', pendingBench: { index: 2, partId: 'W-LAS' } }))
      .toEqual({ kind: 'deny', reason: 'run-is-reference-only' });
  });

  it('caps prep outfitting at the tier budget', () => {
    expect(ask({ phase: 'prep', build: empty })).toEqual({ kind: 'allow' });
    expect(ask({ phase: 'prep', build: heavy }))
      .toEqual({ kind: 'deny', reason: 'over-tier-budget' });
  });

  it('keeps a finished run from becoming a sandbox', () => {
    expect(ask({ phase: 'over', build: empty }))
      .toEqual({ kind: 'deny', reason: 'run-is-reference-only' });
  });

  it('exempts wiring from the prep budget, as the enemy ladder does', () => {
    for (const wiring of ['U-CON', 'U-PIPE']) {
      expect(ask({ phase: 'prep', build: heavy, partId: wiring }), wiring)
        .toEqual({ kind: 'allow' });
    }
  });

  it('admits a part that exactly reaches the budget', () => {
    // The gate is "over budget", not "at budget" — a build may spend it all.
    const atLimit: Build = {
      ...empty,
      parts: [{ instanceId: 'a', partId: 'W-RG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 }],
    };
    const verdict = placementPermission({
      partId: 'U-ARM', build: atLimit, phase: 'prep', pendingBench: null,
    });
    expect(verdict.kind).toBe('allow');
    expect(START_BUDGET).toBeGreaterThan(0);
  });
});
