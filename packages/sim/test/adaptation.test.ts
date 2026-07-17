import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/templates.js';
import { standardOps, searchAdaptation, isKeystone } from '../src/adaptation.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { checkPlacement } from '../src/grid.js';

describe('adaptation ops (docs/05 R10: fitting-only, never keystones)', () => {
  const gunline = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;

  it('every op yields a legal build and never touches keystones', () => {
    for (const op of standardOps()) {
      const modified = op.apply(gunline);
      if (!modified) continue;
      // Keystones (weapons, reactors) unchanged.
      const keystones = (b: typeof gunline) => b.parts.filter((p) => isKeystone(p.partId)).map((p) => p.instanceId).sort().join();
      expect(keystones(modified), op.id).toBe(keystones(gunline));
      // Full placement legality of the modified build.
      const chassis = getChassis(modified.chassisId);
      const placed: typeof modified.parts = [];
      for (const p of modified.parts) {
        expect(checkPlacement(chassis, placed, p, getPart(p.partId)), `${op.id}/${p.instanceId}`).toBeNull();
        placed.push(p);
      }
    }
  });

  it('searchAdaptation is deterministic and evaluates the op catalog', () => {
    const sniper = TEMPLATES.find((t) => t.id === 'vulture-sniper')!.build;
    const a = searchAdaptation(sniper, gunline, { seeds: 4 });
    const b = searchAdaptation(sniper, gunline, { seeds: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.attempts.length).toBeGreaterThan(3);
  });
});
