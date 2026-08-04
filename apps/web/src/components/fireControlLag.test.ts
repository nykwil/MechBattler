import { describe, expect, it } from 'vitest';
import { getPart, type Build } from '@mechbattler/sim';
import { fireControlLateralMultAt, targetProfileMultAt, type BattleView } from './BattleHud.js';

/** The shipped strength, read from the catalog rather than restated here. */
const TC = getPart('U-TC1').fireControlLateralMult!;

/**
 * Fire control scales the *lateral-target penalty* alone. It used to shorten
 * fire-control lag instead, which is also the term projectile time-of-flight
 * rides on — so it quietly improved slow shells too; lag is now a single
 * physical latency nothing buys down.
 *
 * It is a product over parts that declare `fireControlLateralMult`, not a
 * boolean on the id 'U-TC1', so copies compound and a future fire-control part
 * needs no change here.
 *
 * The sim requires the part fitted, functional, and neither shed nor shut down;
 * only the first is visible from a build, so the rest is replayed from events.
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

describe('mech-wide fire control', () => {
  it('is absent when none is fitted', () => {
    expect(fireControlLateralMultAt(view([]), build(['W-MG']), 5, 0)).toBe(1);
  });

  it('is present when fitted and nothing has happened to it', () => {
    expect(fireControlLateralMultAt(view([]), build(['U-TC1']), 5, 0)).toBe(TC);
  });

  it('is lost when the part is shed, shut down or destroyed', () => {
    for (const type of ['shed', 'shutdown'] as const) {
      const v = view([{ tSec: 1, type, mech: 0, instanceId: 'p0' }]);
      expect(fireControlLateralMultAt(v, build(['U-TC1']), 5, 0), type).toBe(1);
    }
    const killed = view([
      { tSec: 1, type: 'part-destroyed', mech: 0, instanceId: 'p0', partId: 'U-TC1', cause: 'damage' },
    ]);
    expect(fireControlLateralMultAt(killed, build(['U-TC1']), 5, 0)).toBe(1);
  });

  it('ignores what has not happened yet', () => {
    // Scrubbing back before the shed must restore the computer's help.
    const v = view([{ tSec: 4, type: 'shed', mech: 0, instanceId: 'p0' }]);
    expect(fireControlLateralMultAt(v, build(['U-TC1']), 2, 0)).toBe(TC);
    expect(fireControlLateralMultAt(v, build(['U-TC1']), 5, 0)).toBe(1);
  });

  it('does not confuse the enemy losing one with your own', () => {
    const v = view([{ tSec: 1, type: 'shed', mech: 1, instanceId: 'p0' }]);
    expect(fireControlLateralMultAt(v, build(['U-TC1']), 5, 0)).toBe(TC);
  });

  it('survives on a second computer when one is lost', () => {
    const v = view([{ tSec: 1, type: 'shed', mech: 0, instanceId: 'p0' }]);
    expect(fireControlLateralMultAt(v, build(['U-TC1', 'U-TC1']), 5, 0)).toBe(TC);
  });

  it('compounds two working computers, as the sim does', () => {
    // The case the old boolean could not represent at all: a second computer
    // was worth exactly nothing.
    expect(fireControlLateralMultAt(view([]), build(['U-TC1', 'U-TC1']), 5, 0))
      .toBeCloseTo(TC * TC, 12);
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
