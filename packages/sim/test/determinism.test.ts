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
import { TEMPLATES } from '../src/templates.js';

function part(instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 = 0): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation, integrity: 1 };
}

function gunline(): Build {
  return structuredClone(TEMPLATES.find((template) => template.id === 'mule-gunline')!.build);
}

function skirmisher(): Build {
  return structuredClone(TEMPLATES.find((template) => template.id === 'mule-skirmisher')!.build);
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

  // The determinism contract, enforced (docs/11 §"Keeping it deterministic"):
  // the sim must never reach for an engine-defined transcendental (use dmath)
  // or any wall-clock / entropy source (all randomness is seeded Pcg32). A new
  // feature that violates this fails here, not in production as a desync.
  it('the sim uses no engine transcendentals or wall-clock/entropy sources', () => {
    const srcDir = join(__dirname, '../src');
    const transcendental = /Math\.(sin|cos|tan|atan2?|asin|acos|exp|log(2|10|1p)?|hypot|pow|cbrt|expm1|sinh|cosh|tanh|random)\b/;
    const nondeterministic = /\b(Date\.now|performance\.now|process\.hrtime|new Date|crypto\.|getRandomValues)\b/;
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts') && f !== 'dmath.ts')) {
      const hits = readFileSync(join(srcDir, file), 'utf8').split('\n')
        .map((line, n) => ({ line: line.replace(/\/\/.*$/, ''), n: n + 1 })) // ignore comments
        .filter(({ line }) => transcendental.test(line) || nondeterministic.test(line))
        .map(({ n }) => `${file}:${n}`);
      expect(hits, `${file} breaks the determinism contract`).toEqual([]);
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

// Re-pinned Aug 1 2026 after the golden fixture moved to the legal canonical
// regional Mule templates. This intentionally replaces the legacy seam-
// crossing layouts that spatial sim 2.0 no longer accepts.
const GOLDEN = {
  winner: 0 as const,
  reason: 'chassis-failure',
  durationS: 59.5,
  shots: [79, 213],
  finalHash: 3950555330,
};
