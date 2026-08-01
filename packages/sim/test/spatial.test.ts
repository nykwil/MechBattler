import { describe, expect, it } from 'vitest';
import {
  Combatant,
  SPATIAL_DEMO_TEMPLATE,
  buildSpatialOccupancy,
  buildThermalModel,
  checkPlacement,
  checkRoutePlacement,
  checkSpatialPartPlacement,
  exposedEquipmentTickets,
  getChassis,
  getPart,
  resolveSpatialPower,
  type PlacedPart,
} from '../src/index.js';

const chassis = getChassis('CH-5');
const demo = () => structuredClone(SPATIAL_DEMO_TEMPLATE.build);

describe('regional construction foundation', () => {
  it('authors Mule as three regions joined by two immutable ports', () => {
    expect(chassis.regions?.map((region) => region.id))
      .toEqual(['left-shoulder', 'body', 'right-shoulder']);
    expect(chassis.ports).toHaveLength(2);
  });

  it('fits shoulder, large-body, long, and rotated equipment without crossing a seam', () => {
    const candidates: PlacedPart[] = [
      { instanceId: 'shoulder-reactor', partId: 'R-E25', origin: { regionId: 'left-shoulder', x: 1, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'large-reactor', partId: 'R-C90', origin: { regionId: 'body', x: 3, y: 2 }, rotation: 0, integrity: 1 },
      { instanceId: 'long-railgun', partId: 'W-RG', origin: { regionId: 'body', x: 0, y: 3 }, rotation: 90, integrity: 1 },
      { instanceId: 'upright-radiator', partId: 'U-RAD', origin: { regionId: 'body', x: 0, y: 2 }, rotation: 90, integrity: 1 },
    ];

    for (const candidate of candidates) {
      expect(checkPlacement(chassis, [], candidate, getPart(candidate.partId)), candidate.instanceId)
        .toBeNull();
      expect(
        checkSpatialPartPlacement(chassis, { parts: [], routes: [] }, candidate),
        candidate.instanceId,
      ).toBeNull();
    }
  });

  it('allows bus and heat pipe to share ordinary and port cells but rejects equipment cells', () => {
    const build = demo();
    const shared = build.routes!.filter((route) => route.x === 0 && route.y === 2);
    expect(shared.map((route) => route.kind).sort()).toEqual(['coolant', 'wire']);
    expect(checkRoutePlacement(chassis, { parts: [], routes: [] }, {
      kind: 'wire', regionId: 'left-shoulder', x: 2, y: 1,
    })).toBeNull();
    expect(checkRoutePlacement(chassis, build, {
      kind: 'wire', regionId: 'left-shoulder', x: 1, y: 0,
    })?.reason).toBe('route-on-equipment');
  });

  it('requires explicit compatible, footprint-matched stacks', () => {
    const build = demo();
    const occupancy = buildSpatialOccupancy(chassis, build);
    expect(occupancy.stacksByCell.get('left-shoulder:1,0')?.map((entry) => entry.layer))
      .toEqual(['support', 'payload', 'armour']);

    const bad: PlacedPart = {
      instanceId: 'bad-shell',
      partId: 'U-SHELL',
      origin: { regionId: 'body', x: 1, y: 2 },
      rotation: 90,
      integrity: 1,
    };
    expect(checkSpatialPartPlacement(chassis, build, bad, getPart(bad.partId))?.reason)
      .toBe('footprint-mismatch');
  });

  it('carries power through routed ports and breaks only the disconnected side', () => {
    const build = demo();
    const intact = resolveSpatialPower(chassis, build);
    expect(intact.connectedInstanceIds.has('turret')).toBe(true);
    expect(intact.connectedInstanceIds.has('carbine')).toBe(true);

    build.routes = build.routes?.filter((route) => !(
      route.kind === 'wire' && route.regionId === 'body' && route.x === 1 && route.y === 2
    ));
    const broken = resolveSpatialPower(chassis, build);
    expect(broken.connectedInstanceIds.has('turret')).toBe(false);
    expect(broken.connectedInstanceIds.has('carbine')).toBe(true);
  });

  it('powers a weapon fitted directly over an energized port socket', () => {
    const build = {
      chassisId: 'CH-5',
      parts: [
        {
          instanceId: 'reactor', partId: 'R-E25',
          origin: { regionId: 'body', x: 0, y: 3 }, rotation: 0 as const, integrity: 1,
        },
        {
          instanceId: 'port-gun', partId: 'W-MG',
          origin: { regionId: 'left-shoulder', x: 1, y: 1 }, rotation: 0 as const, integrity: 1,
        },
      ],
      routes: [
        { kind: 'wire' as const, regionId: 'body', x: 0, y: 2 },
        { kind: 'wire' as const, regionId: 'body', x: 1, y: 2 },
      ],
      chassisIntegrity: 1,
      powerPriority: ['port-gun'],
    };

    expect(checkSpatialPartPlacement(chassis, { parts: [], routes: build.routes }, build.parts[1]!))
      .toBeNull();
    expect(resolveSpatialPower(chassis, build).connectedInstanceIds.has('port-gun')).toBe(true);

    build.routes = build.routes.filter((route) => !(route.x === 1 && route.y === 2));
    expect(resolveSpatialPower(chassis, build).connectedInstanceIds.has('port-gun')).toBe(false);
  });

  it('passes standard bus power through chains of touching ordinary components', () => {
    const build = {
      chassisId: 'CH-5',
      parts: [
        {
          instanceId: 'reactor', partId: 'R-E25',
          origin: { regionId: 'body', x: 0, y: 3 }, rotation: 0 as const, integrity: 1,
        },
        {
          instanceId: 'middle-gun', partId: 'W-MG',
          origin: { regionId: 'body', x: 2, y: 3 }, rotation: 0 as const, integrity: 1,
        },
        {
          instanceId: 'end-gun', partId: 'W-CB',
          origin: { regionId: 'body', x: 4, y: 3 }, rotation: 0 as const, integrity: 1,
        },
      ],
      routes: [],
      chassisIntegrity: 1,
      powerPriority: ['middle-gun', 'end-gun'],
    };

    const power = resolveSpatialPower(chassis, build);
    expect(power.connectedInstanceIds.has('middle-gun')).toBe(true);
    expect(power.connectedInstanceIds.has('end-gun')).toBe(true);
    expect(power.networks[0]?.capacityKwByInstance['end-gun']).toBe(60);
  });

  it('carries heat-pipe conduction through matching port routes', () => {
    const build = demo();
    const thermal = buildThermalModel(chassis, build.parts, build.routes);
    const a = [...thermal.cells.values()].find((cell) =>
      cell.instanceId === '__coolant__:left-shoulder:2,1');
    const b = [...thermal.cells.values()].find((cell) =>
      cell.instanceId === '__coolant__:body:1,2');

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(thermal.edges.some((edge) =>
      (edge.aKey === a!.key && edge.bKey === b!.key)
      || (edge.aKey === b!.key && edge.bKey === a!.key))).toBe(true);
  });
});

describe('uniform exposed-face damage', () => {
  it('builds the authored 6 equipment plus 10 chassis ticket pool', () => {
    const tickets = exposedEquipmentTickets(chassis, demo(), 'front');
    expect(tickets).toHaveLength(6);
    expect(chassis.chassisHitTickets).toBe(10);
    expect(chassis.chassisHitTickets / (tickets.length + chassis.chassisHitTickets)).toBe(0.625);
  });

  it('resolves one selected stack, sends surplus to the chassis, and never drills another cell', () => {
    const target = new Combatant(demo(), { x: 0, y: 0 }, 0);
    const tickets = exposedEquipmentTickets(chassis, target.build, 'front');
    const stackIndex = tickets.findIndex((ticket) => ticket.stackInstanceIds.includes('shell'));
    const roll = (stackIndex + 0.5) / (tickets.length + chassis.chassisHitTickets);
    const result = target.applySpatialHit({ x: -1, y: 0 }, 150, roll);

    expect(result.damaged.map((entry) => entry.instanceId))
      .toEqual(['shell', 'mg', 'turret', '__chassis__']);
    expect(target.partHpFrac('carbine', 'W-CB')).toBe(1);
    expect(target.coreHp).toBe(chassis.maxIntegrity - 35);
  });

  it('lets a perfectly accurate sequence distribute across the whole pool', () => {
    const target = new Combatant(demo(), { x: 0, y: 0 }, 0);
    const kinds = new Set<string>();
    for (let index = 0; index < 16; index++) {
      const result = target.applySpatialHit({ x: -1, y: 0 }, 0.01, (index + 0.5) / 16);
      kinds.add(result.targetKind ?? 'none');
    }
    expect(kinds).toEqual(new Set(['equipment', 'chassis']));
  });
});
