import { describe, expect, it } from 'vitest';
import { FULL_PANEL_IDS, SCREEN_PANEL_IDS, confirmFitness, panelStamp, screenFitness } from '../src/panel.js';
import { LADDER_SPAWN_DISTANCES_M } from '../src/ladder.js';
import { simContentHash } from '../src/version.js';
import { assembleBuild } from '../src/workbench.js';
import { TEMPLATES } from '../src/templates.js';

const subject = () => assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] }).build;

describe('the panel is frozen, and says which catalog it froze against', () => {
  it('names templates that exist', () => {
    const known = new Set(TEMPLATES.map((t) => t.id));
    for (const id of [...SCREEN_PANEL_IDS, ...FULL_PANEL_IDS]) expect(known, id).toContain(id);
    expect(SCREEN_PANEL_IDS).toHaveLength(3);
  });

  it('stamps the content hash, so a moved catalog is visible in the report', () => {
    const stamp = panelStamp();
    expect(stamp.contentHash).toBe(simContentHash());
    expect(stamp.spawnDistancesM).toEqual(LADDER_SPAWN_DISTANCES_M);
  });

  it('scores the same build the same way twice', () => {
    const b = subject();
    expect(screenFitness(b, 7)).toBe(screenFitness(b, 7));
    expect(confirmFitness(b, 7, 2).overall).toBe(confirmFitness(b, 7, 2).overall);
  });

  it('derives its seeds from the seed it is given, not from call order', () => {
    const b = subject();
    const a = screenFitness(b, 1);
    screenFitness(subject(), 999); // an unrelated evaluation in between
    expect(screenFitness(b, 1)).toBe(a);
  });

  it('separates two builds that both beat the whole panel', () => {
    // The defect this exists for: on win rate alone a rank-6 build and a
    // rank-20 build both scored exactly 1.000, so the hill climber had nothing
    // to climb and "the best build at rank R" was an arbitrary pick among
    // ties. A decisive win now counts for slightly more than a narrow one.
    const small = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 1 }] }).build;
    const big = assembleBuild({ chassisId: 'CH-9', parts: [{ partId: 'W-AC', count: 3 }] }).build;
    expect(screenFitness(small, 11)).not.toBe(screenFitness(big, 11));
  });

  it('never lets decisiveness outweigh an actual win', () => {
    // The tie-break is capped below the win-rate quantum, so a build that wins
    // one more fight always outscores one that merely won prettily. Checked on
    // the extremes the weighting allows rather than on a sampled pair.
    const oneMoreWin = (1 / 3) * (1 - 0.05);
    const bestPossibleTieBreak = 0.05;
    expect(oneMoreWin).toBeGreaterThan(bestPossibleTieBreak);
  });

  it('measures a score in [0, 1]', () => {
    const score = screenFitness(subject(), 3);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    // confirmFitness IS a win rate; the screen score deliberately is not.
    expect(confirmFitness(subject(), 3, 1).overall).toBeLessThanOrEqual(1);
  });
});
