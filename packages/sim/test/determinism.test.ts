/**
 * Track B M0/M1 (docs/11): the sim must be bit-identical on every conforming
 * JS engine. dmath replaces the engine's implementation-defined
 * transcendentals; the state hash detects lockstep desync; the goldens pin
 * exact behavior so any divergence — engine, refactor, or accident — fails
 * loudly here first.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { datan, datan2, dcos, dexp, dhypot, dlog, dsin } from '../src/dmath.js';
import { SIM_VERSION, fnv1a, simContentHash } from '../src/version.js';
import { Battle, runBattle } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import type { Build, PlacedPart } from '../src/types.js';

function part(instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 = 0): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation, integrity: 1 };
}

function gunline(): Build {
  return {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-C40', 3, 1), part('ac', 'W-AC', 1, 3),
      part('con1', 'U-CON', 3, 3), part('rad', 'U-RAD', 1, 0), part('arm1', 'U-ARM', 2, 1),
    ],
    powerPriority: [CORE_INSTANCE_ID, 'ac'],
  };
}

function skirmisher(): Build {
  return {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-E25', 3, 1), part('mg1', 'W-MG', 1, 1),
      part('con1', 'U-CON', 3, 3), part('con2', 'U-CON', 2, 3),
      part('mg2', 'W-MG', 1, 3, 90), part('arm1', 'U-ARM', 2, 0),
    ],
    powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'],
  };
}

describe('dmath: deterministic transcendentals (docs/11 M1)', () => {
  it('tracks the native functions closely across the sim range', () => {
    for (let i = -1000; i <= 1000; i++) {
      const x = i * 0.01, y = ((i * 37) % 1000) * 0.013 + 0.0007;
      expect(dsin(x)).toBeCloseTo(Math.sin(x), 12);
      expect(dcos(x)).toBeCloseTo(Math.cos(x), 12);
      expect(datan(x)).toBeCloseTo(Math.atan(x), 12);
      expect(datan2(y, x)).toBeCloseTo(Math.atan2(y, x), 12);
      expect(dhypot(x, y)).toBeCloseTo(Math.hypot(x, y), 10);
    }
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.05;
      expect(dexp(x)).toBeCloseTo(Math.exp(x), Math.max(0, 10 - Math.max(0, x) * 0.44));
      if (x > 0) expect(dlog(x)).toBeCloseTo(Math.log(x), 12);
    }
    expect(dlog(1)).toBe(0);
    expect(dexp(0)).toBe(1);
    expect(dsin(0)).toBe(0);
    expect(datan2(0, 1)).toBe(0);
  });

  it('the sim never calls engine transcendentals outside dmath.ts', () => {
    const srcDir = join(__dirname, '../src');
    const banned = /Math\.(sin|cos|tan|atan2?|asin|acos|exp|log(2|10|1p)?|hypot|pow|cbrt|expm1|sinh|cosh|tanh|random)\b/;
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts') && f !== 'dmath.ts')) {
      const hits = readFileSync(join(srcDir, file), 'utf8').split('\n')
        .map((line, n) => ({ line, n: n + 1 }))
        .filter(({ line }) => banned.test(line));
      expect(hits, `${file} uses engine transcendentals`).toEqual([]);
    }
  });
});

describe('lockstep state hashing & goldens (docs/11 M1)', () => {
  it('two identical battles hash identically at every sampled tick', () => {
    const mk = () => new Battle({ builds: [gunline(), skirmisher()], seed: 20260719 });
    const a = mk(), b = mk();
    for (let t = 0; t < 600; t++) {
      a.step(); b.step();
      if (t % 40 === 0) expect(a.stateHash()).toBe(b.stateHash());
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('a different seed diverges the hash', () => {
    const a = new Battle({ builds: [gunline(), skirmisher()], seed: 1 });
    const b = new Battle({ builds: [gunline(), skirmisher()], seed: 2 });
    for (let t = 0; t < 100; t++) { a.step(); b.step(); }
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  // GOLDEN: pinned observable behavior. If this fails, either the sim's
  // behavior changed (bump SIM_VERSION and re-pin deliberately) or an engine/
  // platform diverged (a lockstep bug — do NOT re-pin, investigate).
  it('golden battle: pinned outcome and final state hash', () => {
    const battle = new Battle({ builds: [gunline(), skirmisher()], seed: 20260719 });
    while (!battle.finished) battle.step();
    const report = battle.report();
    expect({
      winner: report.winner,
      reason: report.reason,
      durationS: Number(report.durationS.toFixed(2)),
      shots: [report.mechs[0].shotsFired, report.mechs[1].shotsFired],
      finalHash: battle.stateHash(),
    }).toEqual(GOLDEN);
  });

  it('content hash is stable within a process and shaped right', () => {
    expect(simContentHash()).toMatch(/^[0-9a-f]{8}$/);
    expect(simContentHash()).toBe(simContentHash());
    expect(SIM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fnv1a('mechbattler')).toMatch(/^[0-9a-f]{8}$/);
  });
});

// Pinned Jul 19 2026 and cross-verified bit-identical on Node, Chromium (V8)
// and Firefox (SpiderMonkey) — see the golden test's comment for re-pin policy.
const GOLDEN = {
  winner: 0 as const,
  reason: 'mission-kill',
  durationS: 40.1,
  shots: [53, 82],
  finalHash: 91580962,
};
