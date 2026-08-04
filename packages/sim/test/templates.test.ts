import { describe, expect, it } from 'vitest';
import { BRANCH_PROBE_TEMPLATES, SPATIAL_DEMO_TEMPLATE, TEMPLATES } from '../src/templates.js';
import { PERK_TEMPLATES } from '../src/diversity.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { checkPlacement } from '../src/grid.js';
import { checkRoutePlacement, checkSpatialPartPlacement } from '../src/spatial.js';
import { resolveSpatialPower } from '../src/spatialPower.js';
import { analyzeRoundRobin, runRoundRobin, type RoundRobinReport } from '../src/harness.js';

describe('template roster is layout-legal and fully powered', () => {
  for (const t of [...TEMPLATES, ...BRANCH_PROBE_TEMPLATES, ...PERK_TEMPLATES, SPATIAL_DEMO_TEMPLATE]) {
    it(`${t.id}: every part placement is legal`, () => {
      const chassis = getChassis(t.build.chassisId);
      const placed: typeof t.build.parts = [];
      for (const p of t.build.parts) {
        const base = checkPlacement(chassis, placed, p, getPart(p.partId));
        const error = base && base.reason !== 'overlap'
          ? base
          : checkSpatialPartPlacement(chassis, { parts: placed, routes: t.build.routes }, p);
        expect(error, `${t.id}/${p.instanceId}: ${JSON.stringify(error)}`).toBeNull();
        placed.push(p);
      }
      const routes: NonNullable<typeof t.build.routes> = [];
      for (const route of t.build.routes ?? []) {
        const error = checkRoutePlacement(chassis, { parts: t.build.parts, routes }, route);
        expect(error, `${t.id}/${route.kind}:${route.regionId}:${route.x},${route.y}`).toBeNull();
        routes.push(route);
      }
    });

    it(`${t.id}: every power-drawing part and the core are connected`, () => {
      const chassis = getChassis(t.build.chassisId);
      const spatial = resolveSpatialPower(chassis, t.build);
      const { connectedInstanceIds } = spatial;
      for (const p of t.build.parts) {
        const def = getPart(p.partId);
        const drawsPower = Boolean(def.draw) || def.category === 'capacitor';
        if (drawsPower) {
          expect(connectedInstanceIds.has(p.instanceId), `${t.id}/${p.instanceId} unpowered`).toBe(true);
        }
      }
      expect(spatial.coreNetworkId, `${t.id} core unpowered`).not.toBeNull();
    });
  }
});

describe('round-robin harness (docs/05 R4)', () => {
  it('is deterministic and produces consistent tallies', () => {
    const pair = TEMPLATES.slice(0, 2);
    const a = runRoundRobin(pair, { seedsPerPair: 4 });
    const b = runRoundRobin(pair, { seedsPerPair: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.battles).toBe(4);
    const m = a.matchups[0]!;
    expect(m.aWins + m.bWins + m.draws).toBe(4);
    const total = a.standings.reduce((s, t) => s + t.wins + t.losses, 0);
    expect(total).toBe((m.aWins + m.bWins) * 2);
  });

  it('turns raw outcomes into an explainable tuning brief', () => {
    const report: RoundRobinReport = {
      seedsPerPair: 10,
      battles: 10,
      matchups: [{
        a: 'alpha', b: 'beta', aWins: 9, bWins: 1, draws: 0, avgDurationS: 20,
        reasons: { 'chassis-failure': 10, 'core-kill': 0, 'mission-kill': 0, judges: 0 },
      }],
      standings: [
        { id: 'alpha', budget: 8, wins: 9, losses: 1, draws: 0, winRate: 0.9 },
        { id: 'beta', budget: 8, wins: 1, losses: 9, draws: 0, winRate: 0.1 },
      ],
      flagged: ['alpha'],
    };
    const brief = analyzeRoundRobin(report);
    expect(brief.healthyMatchups).toBe(0);
    expect(brief.dominantTemplates).toEqual(['alpha']);
    expect(brief.diagnostics.map((d) => d.id)).toEqual([
      'dominant-alpha', 'weak-beta', 'polarized-alpha-beta',
    ]);
  });
});
