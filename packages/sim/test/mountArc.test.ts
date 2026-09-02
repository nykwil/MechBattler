import { describe, expect, it } from 'vitest';
import {
  PARTS, TEMPLATES, computeSpeedProfile, datan2, getChassis, getPart, runBattle,
} from '../src/index.js';

/**
 * `mountArcDeg` and `weaponArcBonusDeg` are inert, and this pins that.
 *
 * A weapon fires only while the bearing to the enemy is inside half its mount
 * arc, and takes a x1.25 dispersion penalty past 75% of it (combat.ts). Both
 * gates are real code. Neither ever fires, because the pilot's `face` verb wins
 * the race by an order of magnitude: turn rate is 45-150 deg/s by chassis, and
 * the bearing to a mech moving a few m/s at 40-160 m changes by a few deg/s.
 *
 * Measured over every template pairing at three seeds -- 195,746 frames -- the
 * median offset is 0.1 deg and the maximum is 11.6. The narrowest arc in the
 * catalog is W-SR's 20 deg, so the tightest gate in the game sits at 10 deg and
 * is essentially never crossed. The Bastion, slowest turner in the game at
 * 48.7 deg/s under load, holds a p99 of 0.84 deg.
 *
 * This matters because it is the whole differentiator of a part: `U-TUR` is a
 * riser that pays 2 kW and 30 kg for +25 deg of arc, and docs/17 F28 is why it
 * reads as dead gear in every sweep. Before authoring anything against arc --
 * a narrow-arc gun, an arc mod, an arc zone -- make this test fail first. If it
 * still passes, the thing you authored cannot be felt.
 */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** The tightest firing gate the catalog can express, in degrees. */
function narrowestHalfArcDeg(): number {
  const arcs = Object.values(PARTS)
    .filter((def) => def.weapon !== undefined)
    .map((def) => def.weapon!.mountArcDeg);
  return Math.min(...arcs) / 2;
}

describe('mount arc is an inert lever', () => {
  it('never lets the bearing to the enemy leave the narrowest arc in the catalog', () => {
    // Two pairings and one seed: enough to hold the property, cheap enough to
    // run in the suite. The 195k-frame sweep is in docs/17 F28.
    const pairs: [number, number][] = [[0, 6], [6, 0]];
    let maxOffsetDeg = 0;

    for (const [i, j] of pairs) {
      const report = runBattle({
        builds: [TEMPLATES[i]!.build, TEMPLATES[j]!.build],
        seed: 4242,
        recordFrames: true,
      });
      for (const frame of report.frames) {
        for (const side of [0, 1] as const) {
          const me = frame.mechs[side];
          const them = frame.mechs[1 - side];
          // Derived exactly as combat.ts derives it, in the sim's own dmath.
          const bearing = datan2(them.y - me.y, them.x - me.x);
          const offsetDeg = Math.abs(wrapAngle(bearing - me.facingRad)) * (180 / Math.PI);
          maxOffsetDeg = Math.max(maxOffsetDeg, offsetDeg);
        }
      }
    }

    expect(maxOffsetDeg).toBeLessThan(narrowestHalfArcDeg());
  });

  it('cannot be made to bind by the slowest turn rate a build can reach', () => {
    // Turn rate is chassis rate x load factor x CoG offset, so the heaviest,
    // worst-balanced build in the canon is the best case for arc mattering.
    const slowest = TEMPLATES
      .map((t) => computeSpeedProfile(getChassis(t.build.chassisId), t.build))
      .reduce((min, p) => (p.turnRateDegS < min.turnRateDegS ? p : min));

    // Even that turns far faster than a target's bearing can sweep, which is
    // the mechanism: nothing a build can do to itself closes the gap.
    expect(slowest.turnRateDegS).toBeGreaterThan(30);
  });

  it('U-TUR buys arc and nothing else a riser does not also buy', () => {
    // The catalog half of F28: if this ever stops being true, the gimbal has
    // been given a second job and the dead-gear verdict needs re-measuring.
    const gimbal = getPart('U-TUR').spatial!;
    const riser = getPart('U-RISE2').spatial!;
    expect(gimbal.weaponArcBonusDeg).toBeGreaterThan(0);
    expect(riser.weaponArcBonusDeg ?? 0).toBe(0);
    expect(gimbal.height).toBe(riser.height);
    expect(gimbal.layer).toBe(riser.layer);
  });
});
