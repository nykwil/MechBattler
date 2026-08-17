import { describe, expect, it } from 'vitest';
import { getChassis, type Build } from '@mechbattler/sim';
import { chassisMoveJitterMultAt, type BattleView } from './BattleHud.js';

/**
 * The sim's `effectiveDispersionRad` steadies a shot by
 * `(chassis.moveJitterMult ?? 1) * self.mechMoveJitterMult(tile)`. The spread
 * overlay and the diagnostics readout each passed only the chassis half, so a
 * mech-wide suspension mod moved the shot the sim scored without moving the
 * mark drawn over it -- Coil-sprung actuators (mechMoveJitter x0.6) drew the
 * spread ~1.67x too wide, Weaving gait (x1.3) too narrow.
 *
 * These pin the mech-wide half, which is the term that kept getting dropped.
 */
const CHASSIS_ID = 'CH-5';

const view: BattleView = {
  frames: [],
  events: [],
  arena: { lengthM: 200, widthM: 100 },
  terrain: { cols: 1, rows: 1, tiles: ['open'] } as unknown as BattleView['terrain'],
  mechs: [
    { chassisId: CHASSIS_ID, capacitorMaxKj: 0 },
    { chassisId: CHASSIS_ID, capacitorMaxKj: 0 },
  ] as unknown as BattleView['mechs'],
};

const ctx = { speedMps: 4, tile: 'open' as const };

function buildWith(modifiers: string[]): Build {
  return {
    chassisId: CHASSIS_ID,
    powerPriority: [],
    parts: [{
      instanceId: 'stride-1', partId: 'U-ACT',
      origin: { regionId: 'body', x: 0, y: 0 }, rotation: 0, integrity: 1,
      modifiers,
    }],
  };
}

describe('chassisMoveJitterMultAt: the chassis half times the mech-wide half', () => {
  const chassisOnly = getChassis(CHASSIS_ID).moveJitterMult ?? 1;

  it('is the bare chassis figure when nothing mech-wide is fitted', () => {
    expect(chassisMoveJitterMultAt(view, buildWith([]), 0, 0, ctx)).toBeCloseTo(chassisOnly, 10);
  });

  it('folds in Coil-sprung actuators, which the instruments used to drop', () => {
    const withMod = chassisMoveJitterMultAt(view, buildWith(['coil-sprung']), 0, 0, ctx);
    expect(withMod).toBeCloseTo(chassisOnly * 0.6, 10);
    // The bug: the spread was drawn 1/0.6 = ~1.67x wider than the shot.
    expect(chassisOnly / withMod).toBeCloseTo(1 / 0.6, 6);
  });

  it('folds in Weaving gait, which pushes the other way', () => {
    expect(chassisMoveJitterMultAt(view, buildWith(['weaving-gait']), 0, 0, ctx))
      .toBeCloseTo(chassisOnly * 1.3, 10);
  });

  it('drops a part once it is shed, shut down or destroyed', () => {
    const shed: BattleView = {
      ...view,
      events: [{ tSec: 1, type: 'shed', mech: 0, instanceId: 'stride-1' }] as BattleView['events'],
    };
    // Before the event the mod still counts; after it, the mech is back to bare.
    expect(chassisMoveJitterMultAt(shed, buildWith(['coil-sprung']), 0.5, 0, ctx))
      .toBeCloseTo(chassisOnly * 0.6, 10);
    expect(chassisMoveJitterMultAt(shed, buildWith(['coil-sprung']), 2, 0, ctx))
      .toBeCloseTo(chassisOnly, 10);
  });

  it('reads only its own mech: mech 1 shedding does not steady mech 0', () => {
    const otherShed: BattleView = {
      ...view,
      events: [{ tSec: 1, type: 'shed', mech: 1, instanceId: 'stride-1' }] as BattleView['events'],
    };
    expect(chassisMoveJitterMultAt(otherShed, buildWith(['coil-sprung']), 2, 0, ctx))
      .toBeCloseTo(chassisOnly * 0.6, 10);
  });
});
