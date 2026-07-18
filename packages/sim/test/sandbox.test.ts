import { describe, expect, it } from 'vitest';
import { CORE_INSTANCE_ID, runRangeSandbox, targetDummyBuild } from '../src/index.js';
import type { Build, PlacedPart } from '../src/index.js';

function muleGunline(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac'] };
}

describe('range sandbox (docs/02 §6 bench diagnostics)', () => {
  it('measures real windowed dps in reach and honest zero beyond fire-control reach', () => {
    const [near, far] = runRangeSandbox({
      build: muleGunline(),
      rangesM: [50, 220],
      durationS: 30,
      seed: 7,
    });

    // 50 m sits in the AC's ×1.0 falloff band: it fires and lands damage.
    expect(near!.rangeM).toBe(50);
    expect(near!.shots).toBeGreaterThan(20);
    expect(near!.dps).toBeGreaterThan(3);
    expect(near!.hitFrac).toBeGreaterThan(0.3);
    expect(near!.weapons[0]!.partId).toBe('W-AC');

    // 220 m is past the AC's despawn bound (150 × 1.3): fire control holds,
    // and the dummy must not have surrendered to end the window early.
    expect(far!.dps).toBe(0);
    expect(far!.shots).toBe(0);
    expect(far!.elapsedS).toBeGreaterThanOrEqual(30);
    expect(far!.targetDestroyed).toBe(false);
  });

  it('attributes the window: full uptime in band, range-gated silence beyond reach', () => {
    const [near, far] = runRangeSandbox({
      build: muleGunline(),
      rangesM: [50, 220],
      durationS: 20,
      seed: 7,
    });
    const acNear = near!.weapons.find((w) => w.partId === 'W-AC')!;
    expect(acNear.uptimeFrac).toBeGreaterThan(0.9);
    const acFar = far!.weapons.find((w) => w.partId === 'W-AC')!;
    expect(acFar.uptimeFrac).toBeLessThan(0.1);
    expect(acFar.downFracs.range ?? 0).toBeGreaterThan(0.9);
  });

  it('the target dummy is a valid weaponless armor slab', () => {
    const dummy = targetDummyBuild();
    expect(dummy.parts.length).toBeGreaterThan(30);
    expect(dummy.parts.every((p) => p.partId === 'U-ARM')).toBe(true);
  });
});
