import { describe, expect, it } from 'vitest';
import {
  I1_THRESHOLD_PLUS1, I1_THRESHOLD_PLUS2, I2_MAX_SPREAD,
  bestVsBest, checkChassisParity, checkCoverage, checkRankMonotonicity,
  ranksOfCorrectBuilding, saturationRank,
} from '../src/invariants.js';
import { BuildArchive, describeBuild } from '../src/archive.js';
import { assembleBuild } from '../src/workbench.js';
import type { RankResult } from '../src/breeding.js';

const buildOf = (chassisId: string, partId: string, count: number) =>
  assembleBuild({ chassisId, parts: [{ partId, count }] }).build;

/** A RankResult with a hand-set ceiling — these read archives, they run no search. */
const fake = (chassisId: string, rank: number, ceiling: number, build = buildOf('CH-5', 'W-AC', 2)): RankResult => {
  const archive = new BuildArchive();
  archive.insert({ build, descriptors: describeBuild(build), fitness: ceiling, genome: null });
  return { rank, chassisId, archive, ceiling, best: archive.best()!, evaluations: 0, legalFound: 1 };
};

describe('I1 — a higher rank should beat a lower one', () => {
  it('measures best vs best across every spawn distance, both sides', () => {
    const rate = bestVsBest(buildOf('CH-9', 'W-AC', 2), buildOf('CH-2', 'W-MG', 1), 1);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
    expect(bestVsBest(buildOf('CH-9', 'W-AC', 2), buildOf('CH-2', 'W-MG', 1), 1)).toBe(rate);
  }, 300_000);

  it('holds a +2 pair to the higher threshold than a +1 pair', () => {
    expect(I1_THRESHOLD_PLUS2).toBeGreaterThan(I1_THRESHOLD_PLUS1);
    const findings = checkRankMonotonicity([fake('CH-5', 8, 0.4), fake('CH-5', 9, 0.5), fake('CH-5', 10, 0.6)], 1);
    const plus2 = findings.find((f) => f.gap === 2);
    const plus1 = findings.find((f) => f.gap === 1);
    expect(plus2?.threshold).toBe(I1_THRESHOLD_PLUS2);
    expect(plus1?.threshold).toBe(I1_THRESHOLD_PLUS1);
    expect(plus2?.pass).toBe(plus2!.winRate >= I1_THRESHOLD_PLUS2);
  }, 300_000);
});

describe('saturation is where a chassis stops being able to spend', () => {
  it('names the rank after which the ceiling stops climbing for two ranks', () => {
    const results = [
      fake('CH-2', 6, 0.30), fake('CH-2', 8, 0.45), fake('CH-2', 10, 0.60),
      fake('CH-2', 12, 0.60), fake('CH-2', 14, 0.59),
    ];
    expect(saturationRank(results)).toBe(10);
  });

  it('returns null when the ceiling is still climbing at the top', () => {
    expect(saturationRank([fake('CH-9', 6, 0.2), fake('CH-9', 8, 0.4), fake('CH-9', 10, 0.6)])).toBeNull();
  });

  it('names the rank where a chassis could build nothing at all', () => {
    const dead = { ...fake('CH-2', 12, 0), legalFound: 0, best: null };
    expect(saturationRank([fake('CH-2', 8, 0.4), fake('CH-2', 10, 0.5), dead])).toBe(12);
  });
});

describe('I2 — chassis parity, below saturation', () => {
  it('flags a spread wider than 8 points and names both ends', () => {
    const byChassis = new Map([
      ['CH-2', [fake('CH-2', 10, 0.40)]],
      ['CH-5', [fake('CH-5', 10, 0.62)]],
    ]);
    const [finding] = checkChassisParity(byChassis);
    expect(finding!.spread).toBeCloseTo(0.22, 5);
    expect(finding!.pass).toBe(false);
    expect(finding!.worst).toBe('CH-2');
    expect(finding!.best).toBe('CH-5');
    expect(I2_MAX_SPREAD).toBe(0.08);
  });

  it('passes a spread inside the band', () => {
    const byChassis = new Map([
      ['CH-2', [fake('CH-2', 10, 0.55)]],
      ['CH-5', [fake('CH-5', 10, 0.60)]],
    ]);
    expect(checkChassisParity(byChassis)[0]!.pass).toBe(true);
  });
});

describe('I3 — no dead gear', () => {
  it('names gear that appears in no elite, and excludes U-AMMO by declaration', () => {
    const archive = new BuildArchive();
    const b = buildOf('CH-5', 'W-AC', 2);
    archive.insert({ build: b, descriptors: describeBuild(b), fitness: 0.5, genome: null });
    const coverage = checkCoverage([archive]);
    expect(coverage.deadParts).not.toContain('W-AC');
    expect(coverage.deadParts).not.toContain('U-AMMO');
    expect(coverage.deadParts).toContain('W-RG');
    expect(coverage.usage.get('W-AC')).toBeGreaterThan(0);
  });
});

describe('the headline: how many ranks of enemy correct building is worth', () => {
  it('reports the first k at which the win rate falls to a coin flip or below', () => {
    const results = [fake('CH-5', 10, 0.5), fake('CH-5', 11, 0.5), fake('CH-5', 12, 0.5)];
    const measured = ranksOfCorrectBuilding(results, 10, 1);
    expect(measured.ladder.length).toBeGreaterThan(0);
    expect(measured.k === null || measured.k >= 1).toBe(true);
  }, 300_000);
});
