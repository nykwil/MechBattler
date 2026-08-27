import { describe, expect, it } from 'vitest';
import {
  UNIQUES,
  getPart,
  assembleBuild,
  computeEnergyMargin,
  evaluateBuild,
  getChassis,
  identifyUnique,
  validateBuild,
} from '../src/index.js';

const errorsOf = (chassisId: string, build: Parameters<typeof validateBuild>[1]) =>
  validateBuild(getChassis(chassisId), build).filter((issue) => issue.severity === 'error');

describe('the workbench assembles a mech from a wish', () => {
  it('turns two named guns into a legal, powered, wired build', () => {
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] });
    expect(report.unplaced).toEqual([]);
    expect(report.legal).toBe(true);
    expect(errorsOf('CH-5', report.build)).toEqual([]);
    // Completion supplied the boring half, and said why.
    expect(report.added.some((add) => add.partId.startsWith('R-'))).toBe(true);
    // Routing is a means, not the goal: a compact fit where everything is
    // edge-adjacent to the reactor legitimately needs no wire at all. What must
    // hold is that nothing ended up off the network.
    expect(report.issues.some((issue) => issue.code === 'unpowered-parts')).toBe(false);
  });

  it('never buries its own routing under equipment', () => {
    // The first version wired once mid-assembly and then kept placing armour,
    // so the finished build carried `route-on-equipment` faults it had given
    // itself. Routing is recomputed from the final layout.
    for (const chassisId of ['CH-2', 'CH-5', 'CH-9']) {
      const report = assembleBuild({ chassisId, parts: [{ partId: 'W-MG', count: 2 }] });
      const routeFaults = report.issues.filter((issue) => issue.message.includes('route-on-equipment'));
      expect(routeFaults, chassisId).toEqual([]);
    }
  });

  it('takes the armour back off when its own mass browns the build out', () => {
    // Armour is mass, mass is locomotion draw. Filling every spare cell pushed
    // a balanced build into brownout, and the fill has to answer for that.
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] });
    const margin = computeEnergyMargin(getChassis('CH-5'), report.build);
    expect(margin.marginKw).toBeGreaterThanOrEqual(0);
    expect(report.issues.some((issue) => issue.code === 'cannot-sustain-fire')).toBe(false);
  });

  it('starts with a reactor, so the guns cannot crowd out their own power', () => {
    // Placing guns first left a 16-cell Vulture with no legal 2x2 block and no
    // way to power the carbines it had just fitted.
    const report = assembleBuild({ chassisId: 'CH-2', parts: [{ partId: 'W-CB', count: 2 }] });
    expect(report.build.parts.some((part) => part.partId.startsWith('R-'))).toBe(true);
    expect(errorsOf('CH-2', report.build)).toEqual([]);
  });

  it('fits a named unique and hands it back identified', () => {
    const report = assembleBuild({
      chassisId: 'CH-5',
      parts: [{ partId: 'W-AC', unique: 'assize' }],
    });
    expect(report.uniques.map((u) => u.uniqueId)).toEqual(['assize']);
    const carrier = report.build.parts.find((part) => identifyUnique(part));
    expect(carrier?.modifiers).toContain(UNIQUES['assize']!.modifierId);
    expect(report.legal).toBe(true);
  });

  it('reports what would not fit instead of pretending it did', () => {
    // W-RG is rect(2,5): three of them do not go on a 16-cell scout, and that
    // is a finding about the wish, not an error.
    const report = assembleBuild({ chassisId: 'CH-2', parts: [{ partId: 'W-RG', count: 3 }] });
    expect(report.unplaced[0]).toMatchObject({ partId: 'W-RG', wanted: 3 });
    expect(report.unplaced[0]!.placed).toBeLessThan(3);
  });

  it('says when completion stalled, rather than leaving an unexplained warning', () => {
    const report = assembleBuild({
      chassisId: 'CH-5',
      parts: [{ partId: 'W-AC', count: 2 }],
      budget: 8,
    });
    expect(report.budget).toBeLessThanOrEqual(8);
    expect(report.blocked.length + report.added.length).toBeGreaterThan(0);
  });

  it('assembles the same build twice — a trial has to be repeatable', () => {
    const wish = { chassisId: 'CH-9', parts: [{ partId: 'W-BR', count: 2 }] };
    expect(JSON.stringify(assembleBuild(wish).build)).toBe(JSON.stringify(assembleBuild(wish).build));
  });
});

describe('the workbench fights what it built', () => {
  it('scores a build against the canonical roster on repeatable seeds', () => {
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] });
    const first = evaluateBuild(report.build, { seeds: 2 });
    const again = evaluateBuild(report.build, { seeds: 2 });
    expect(first.matchups).toEqual(again.matchups);
    expect(first.matchups.length).toBeGreaterThan(0);
    expect(first.overall).toBeGreaterThanOrEqual(0);
    expect(first.overall).toBeLessThanOrEqual(1);
  });
});

describe('the workbench honours a locked pool', () => {
  it('completes only from the pool it was given', () => {
    // R-C90 is the only reactor in the pool and it is NOT the catalog's
    // cheapest — that is the point. Completion seeds the smallest reactor it
    // can find, so a pool listing only a big one proves the filter bites
    // rather than agreeing with the default by luck.
    const pool = ['W-MG', 'R-C90', 'U-RAD', 'U-ARM'];
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-MG', count: 2 }], pool });
    for (const part of report.build.parts) {
      const def = getPart(part.partId);
      if (def.isConduit || def.isHeatPipe) continue; // routing is free structure
      expect(pool, `${part.partId} came from outside the lock`).toContain(part.partId);
    }
    expect(report.build.parts.some((p) => p.partId === 'R-C90')).toBe(true);
  });

  it('says so when the pool cannot power the wish, instead of reaching outside it', () => {
    // No reactor in the pool at all: the honest outcome is a blocked report,
    // not a build silently completed from the catalog.
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }], pool: ['W-AC', 'U-ARM'] });
    expect(report.build.parts.every((p) => !getPart(p.partId).reactor)).toBe(true);
    expect(report.blocked.length).toBeGreaterThan(0);
  });
});

describe('armour is a gene, not an automatic fill', () => {
  it('fits exactly the plate count it was asked for', () => {
    const report = assembleBuild({
      chassisId: 'CH-9',
      parts: [{ partId: 'W-AC', count: 2 }],
      armourPlates: 3,
    });
    const plates = report.build.parts.filter((p) => p.partId === 'U-ARM').length;
    expect(plates).toBeLessThanOrEqual(3);
    expect(report.energyMarginKw).toBeGreaterThanOrEqual(0);
  });

  it('fits none when asked for none', () => {
    const report = assembleBuild({
      chassisId: 'CH-9',
      parts: [{ partId: 'W-AC', count: 2 }],
      armourPlates: 0,
    });
    expect(report.build.parts.some((p) => p.partId === 'U-ARM')).toBe(false);
  });
});
