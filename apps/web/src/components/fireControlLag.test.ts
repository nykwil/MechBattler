import { describe, expect, it } from 'vitest';
import type { Build } from '@mechbattler/sim';
import { hasPoweredTcAt, targetProfileMultAt } from './BattleHud.js';
import type { BattleView } from './BattleHud.js';

/**
 * Fire-control lag is 0.3 s, or 0.1 s with a *powered* targeting computer. The sim
 * requires the part fitted, functional, and neither shed nor shut down; only the
 * first is visible from a build, so the rest is replayed from events.
 *
 * It matters because the spread drawn on the arena and the diagnostics overlay both
 * feed this into computeHitModel. Getting it wrong makes both disagree with the sim
 * exactly on the builds fitted to change it — an instrument lying about the term it
 * exists to show.
 */
const build = (partIds: string[]): Build => ({
  chassisId: 'CH-2',
  parts: partIds.map((partId, i) => ({
    instanceId: `p${i}`, partId, origin: { x: i, y: 0 }, rotation: 0 as const, integrity: 1,
  })),
  powerPriority: [],
});

const view = (events: BattleView['events']): BattleView => ({
  frames: [], events, arena: { lengthM: 240, widthM: 240 },
  terrain: { cellSizeM: 20, cols: 12, rows: 12, cells: [] },
  mechs: [{ chassisId: 'CH-2', capacitorMaxKj: 0 }, { chassisId: 'CH-2', capacitorMaxKj: 0 }],
});

describe('powered targeting computer', () => {
  it('is absent when none is fitted', () => {
    expect(hasPoweredTcAt(view([]), build(['W-MG']), 5, 0)).toBe(false);
  });

  it('is present when fitted and nothing has happened to it', () => {
    expect(hasPoweredTcAt(view([]), build(['U-TC1']), 5, 0)).toBe(true);
  });

  it('is lost when the part is shed, shut down or destroyed', () => {
    for (const type of ['shed', 'shutdown'] as const) {
      const v = view([{ tSec: 1, type, mech: 0, instanceId: 'p0' }]);
      expect(hasPoweredTcAt(v, build(['U-TC1']), 5, 0), type).toBe(false);
    }
    const killed = view([
      { tSec: 1, type: 'part-destroyed', mech: 0, instanceId: 'p0', partId: 'U-TC1', cause: 'damage' },
    ]);
    expect(hasPoweredTcAt(killed, build(['U-TC1']), 5, 0)).toBe(false);
  });

  it('ignores what has not happened yet', () => {
    // Scrubbing back before the shed must restore the shorter lag.
    const v = view([{ tSec: 4, type: 'shed', mech: 0, instanceId: 'p0' }]);
    expect(hasPoweredTcAt(v, build(['U-TC1']), 2, 0)).toBe(true);
    expect(hasPoweredTcAt(v, build(['U-TC1']), 5, 0)).toBe(false);
  });

  it('does not confuse the enemy losing one with your own', () => {
    const v = view([{ tSec: 1, type: 'shed', mech: 1, instanceId: 'p0' }]);
    expect(hasPoweredTcAt(v, build(['U-TC1']), 5, 0)).toBe(true);
  });

  it('survives on a second computer when one is lost', () => {
    const v = view([{ tSec: 1, type: 'shed', mech: 0, instanceId: 'p0' }]);
    expect(hasPoweredTcAt(v, build(['U-TC1', 'U-TC1']), 5, 0)).toBe(true);
  });
});

/**
 * A target's profile multiplier narrows the silhouette a shot is scored against.
 * Same replay rules as the targeting computer: a modifier stops counting once its
 * part is destroyed, shed or shut down.
 */
describe('target profile multiplier', () => {
  const ctx = { speedMps: 0, tile: 'open' as const };
  const modded = (): Build => {
    const b = build(['U-ARM']);
    b.parts[0]!.modifiers = ['hull-down'];
    return b;
  };

  it('is neutral with no build, no modifiers, or a part that carries none', () => {
    expect(targetProfileMultAt(view([]), undefined, 5, 1, ctx)).toBe(1);
    expect(targetProfileMultAt(view([]), build(['U-ARM']), 5, 1, ctx)).toBe(1);
  });

  it('stops counting a modifier once its part is gone', () => {
    const before = targetProfileMultAt(view([]), modded(), 5, 1, ctx);
    const shed = view([{ tSec: 1, type: 'shed', mech: 1, instanceId: 'p0' }]);
    const after = targetProfileMultAt(shed, modded(), 5, 1, ctx);
    // Whatever hull-down is worth, losing the part must return the target to neutral.
    expect(after).toBe(1);
    expect(before).not.toBe(after);
  });

  it('reads the mech it was asked about, not the other one', () => {
    const mine = view([{ tSec: 1, type: 'shed', mech: 0, instanceId: 'p0' }]);
    expect(targetProfileMultAt(mine, modded(), 5, 1, ctx)).not.toBe(1);
  });

  it('ignores events after the moment being drawn', () => {
    const later = view([{ tSec: 4, type: 'shed', mech: 1, instanceId: 'p0' }]);
    expect(targetProfileMultAt(later, modded(), 2, 1, ctx)).not.toBe(1);
    expect(targetProfileMultAt(later, modded(), 5, 1, ctx)).toBe(1);
  });
});
