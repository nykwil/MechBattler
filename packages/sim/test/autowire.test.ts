import { describe, expect, it } from 'vitest';
import { applyAutoWire, autoWire } from '../src/autowire.js';
import { computeConnectivity, computeCoreNetwork } from '../src/grid.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { TEMPLATES } from '../src/templates.js';
import type { Build } from '../src/types.js';

describe('auto-wire baseline (docs/09 M4)', () => {
  it('re-wires every template build stripped of its conduits to full connectivity', () => {
    for (const t of TEMPLATES) {
      const chassis = getChassis(t.build.chassisId);
      const stripped: Build = {
        ...t.build,
        parts: t.build.parts.filter((p) => !getPart(p.partId).isConduit),
      };
      const { build: wired, result } = applyAutoWire(chassis, stripped);
      expect(result.unreachableInstanceIds, t.id).toEqual([]);
      const { connectedInstanceIds } = computeConnectivity(wired.parts);
      for (const p of wired.parts) {
        const def = getPart(p.partId);
        const needsPower = Boolean(def.draw) || def.category === 'weapon' || def.category === 'capacitor';
        if (needsPower) expect(connectedInstanceIds.has(p.instanceId), `${t.id}: ${p.instanceId}`).toBe(true);
      }
      expect(computeCoreNetwork(chassis, wired.parts), `${t.id}: core`).not.toBeNull();
    }
  });

  it('is deterministic and a no-op on an already-wired build', () => {
    const t = TEMPLATES[0]!;
    const chassis = getChassis(t.build.chassisId);
    const a = autoWire(chassis, t.build);
    const b = autoWire(chassis, t.build);
    expect(a).toEqual(b);
    const { build: wired } = applyAutoWire(chassis, t.build);
    const again = autoWire(chassis, wired);
    expect(again.conduits).toEqual([]);
  });

  it('reports unreachable parts cleanly when there is no reactor', () => {
    const chassis = getChassis('CH-5');
    const build: Build = {
      chassisId: 'CH-5',
      parts: [{ instanceId: 'mg', partId: 'W-MG', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 }],
      powerPriority: [],
    };
    const result = autoWire(chassis, build);
    expect(result.conduits).toEqual([]);
    expect(result.unreachableInstanceIds).toEqual(['mg']);
  });
});
