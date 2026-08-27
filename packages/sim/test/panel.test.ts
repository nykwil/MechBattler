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

  it('measures a win rate in [0, 1]', () => {
    const score = screenFitness(subject(), 3);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
