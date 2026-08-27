import { describe, expect, it } from 'vitest';
import { BuildArchive, cellKey, describeBuild } from '../src/archive.js';
import { assembleBuild } from '../src/workbench.js';
import { computeIdealRangeBand } from '../src/derivedStats.js';

const build = (chassisId: string, partId: string, count: number) =>
  assembleBuild({ chassisId, parts: [{ partId, count }], armourPlates: 0 }).build;

describe('descriptors are read off the sim, never typed', () => {
  it("buckets range on the midpoint of the sim's own ideal band", () => {
    const b = build('CH-2', 'W-MG', 2);
    const band = computeIdealRangeBand(b);
    const d = describeBuild(b);
    expect(d.rangeM).toBeCloseTo((band.bandStart + band.bandEnd) / 2, 5);
    expect(d.range).toBe(d.rangeM < 45 ? 'close' : d.rangeM > 100 ? 'long' : 'mid');
  });

  it('reads the kill method off the weapon fields', () => {
    // W-SC carries enemyHeatKj; W-ION carries capDrainKj; W-MG neither.
    expect(describeBuild(build('CH-5', 'W-SC', 1)).kill).toBe('heat');
    expect(describeBuild(build('CH-5', 'W-ION', 1)).kill).toBe('power');
    expect(describeBuild(build('CH-5', 'W-MG', 2)).kill).toBe('damage');
  });

  it('names a cell by range, weight and heat only', () => {
    const d = describeBuild(build('CH-9', 'W-AC', 2));
    expect(cellKey(d)).toBe(`${d.range}/${d.weight}/${d.heat}`);
    // Kill method is a label, not a dimension.
    expect(cellKey(d)).not.toContain(d.kill);
  });
});

describe('the archive keeps the best per cell', () => {
  it('replaces a weaker occupant and rejects a weaker challenger', () => {
    const b = build('CH-9', 'W-AC', 2);
    const d = describeBuild(b);
    const archive = new BuildArchive();
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.4, genome: null })).toBe(true);
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.6, genome: null })).toBe(true);
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.5, genome: null })).toBe(false);
    expect(archive.cells().get(cellKey(d))?.fitness).toBe(0.6);
    expect(archive.best()?.fitness).toBe(0.6);
  });

  it('reports the cells nobody filled, because an empty cell is the finding', () => {
    const archive = new BuildArchive();
    const b = build('CH-9', 'W-AC', 2);
    archive.insert({ build: b, descriptors: describeBuild(b), fitness: 0.5, genome: null });
    // 3 ranges x 3 weights x 2 heats = 18 slots; one is filled.
    expect(archive.emptyCells()).toHaveLength(17);
  });
});
