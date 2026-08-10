import { describe, expect, it } from 'vitest';
import { TEMPLATES, getChassis, type Build } from '@mechbattler/sim';
import { describePlacement } from './describePlacement.js';

/** A real blueprint, so the preview is fitted into a build the sim accepts. */
const starter = (): Build => {
  const template = TEMPLATES.find((t) => t.build.chassisId === 'CH-5');
  if (!template) throw new Error('no CH-5 template to build a fixture from');
  return structuredClone(template.build);
};

const describeAt = (origin: { x: number; y: number }, partId = 'W-MG') =>
  describePlacement({
    chassis: getChassis('CH-5'),
    build: starter(),
    partId,
    origin,
    rotation: 0,
    extras: { integrity: 1 },
  });

describe('describePlacement', () => {
  it('names the region a legal cell belongs to', () => {
    // Every placeable cell is in some region, so the region name is always the
    // first fact — a summary that leads with an empty string means the preview
    // resolved against a cell the chassis does not have.
    const chassis = getChassis('CH-5');
    const region = chassis.regions?.[0];
    if (!region) throw new Error('CH-5 has no regions');
    const y = region.mask.findIndex((row) => row.some(Boolean));
    const x = region.mask[y]!.findIndex(Boolean);

    const summary = describeAt({ x, y });
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeGreaterThan(0);
    expect(summary!.split(' · ')[0]).not.toBe('');
  });

  it('still answers for an origin off the mask', () => {
    // Measured, not assumed: `resolvePlacementEffects` finds the preview part by
    // instance id and returns effects with no cells rather than null, so the ghost
    // line falls back to the chassis's own region name. The null branch is reachable
    // only if the preview is not in the build it is asked about, which this function
    // makes impossible -- it is kept because the sim's signature admits it.
    expect(describeAt({ x: 99, y: 99 })).not.toBeNull();
  });

  it('joins its facts with the separator the ghost line renders', () => {
    const chassis = getChassis('CH-5');
    const region = chassis.regions?.[0];
    if (!region) throw new Error('CH-5 has no regions');
    const y = region.mask.findIndex((row) => row.some(Boolean));
    const x = region.mask[y]!.findIndex(Boolean);

    const summary = describeAt({ x, y });
    expect(summary).not.toBeNull();
    // Never a trailing or doubled separator, which is what an unfiltered join gives.
    expect(summary!).not.toMatch(/ · $/);
    expect(summary!).not.toMatch(/ ·  · /);
  });

  it('does not leave the preview part in the caller\'s build', () => {
    // It fits a copy to ask the question; mutating the real build here would place
    // a part the player never placed.
    const build = starter();
    const before = build.parts.length;
    describePlacement({
      chassis: getChassis('CH-5'),
      build,
      partId: 'W-MG',
      origin: { x: 0, y: 0 },
      rotation: 0,
      extras: { integrity: 1 },
    });
    expect(build.parts).toHaveLength(before);
  });
});
