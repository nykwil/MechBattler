import { describe, expect, it } from 'vitest';
import { crossingSpeedMps } from './evade.js';

const TICK = 1 / 20;
/**
 * A distant foe, so the line of sight barely rotates over one tick of movement.
 * With the foe at 50m, moving 1m across it swings the bearing by about a degree
 * and the crossing component reads 19.996 rather than 20 — correct, but it makes
 * an exact assertion about geometry impossible to state cleanly.
 */
const FAR = { x: 1e6, y: 0 };

describe('crossingSpeedMps', () => {
  it('is zero for a mech closing straight down the line of sight', () => {
    // Moving directly toward the foe: no crossing component at all.
    const speed = crossingSpeedMps({ x: 0, y: 0 }, { x: 1, y: 0 }, FAR, TICK);
    expect(speed).toBeCloseTo(0, 4);
  });

  it('is the full speed for a mech moving straight across it', () => {
    // 1m in one tick across a foe due east is 20 m/s of pure crossing.
    const speed = crossingSpeedMps({ x: 0, y: 0 }, { x: 0, y: 1 }, FAR, TICK);
    expect(speed).toBeCloseTo(20, 4);
  });

  it('takes only the perpendicular component of a diagonal', () => {
    const speed = crossingSpeedMps({ x: 0, y: 0 }, { x: 1, y: 1 }, FAR, TICK);
    // Diagonal at 45 degrees: only the across-bearing half counts, so the closing
    // 20 m/s is discarded and the crossing 20 m/s is kept.
    expect(speed).toBeCloseTo(20, 4);
  });

  it('does not care which way across you go', () => {
    const left = crossingSpeedMps({ x: 0, y: 0 }, { x: 0, y: 1 }, FAR, TICK);
    const right = crossingSpeedMps({ x: 0, y: 0 }, { x: 0, y: -1 }, FAR, TICK);
    expect(left).toBeCloseTo(right, 6);
  });

  it('is zero when standing still', () => {
    expect(crossingSpeedMps({ x: 3, y: 4 }, { x: 3, y: 4 }, { x: 0, y: 0 }, TICK)).toBe(0);
  });

  it('survives a degenerate tick or a co-located foe', () => {
    expect(crossingSpeedMps({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, 0)).toBe(0);
    expect(Number.isFinite(crossingSpeedMps({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }, TICK)))
      .toBe(true);
  });
});
