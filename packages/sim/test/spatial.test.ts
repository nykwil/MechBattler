import { describe, expect, it } from 'vitest';
import {
  Combatant,
  SPATIAL_DEMO_TEMPLATE,
  Simulation,
  buildSpatialOccupancy,
  buildThermalModel,
  checkPlacement,
  checkRoutePlacement,
  checkSpatialPartPlacement,
  exposedEquipmentTickets,
  getChassis,
  getPart,
  locationEffectsForPart,
  resolvePlacementEffects,
  resolveSpatialPower,
  resolveThermalPaths,
  validateWholeBuildPlacement,
  type PlacedPart,
} from '../src/index.js';
import { cellCeiling, forwardClearance, occupantTop, partHeight, stackBase } from '../src/spatial.js';

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

    const floatingShell: PlacedPart = {
      instanceId: 'floating-shell', partId: 'U-SHELL',
      origin: { regionId: 'left-shoulder', x: 1, y: 0 }, rotation: 0, integrity: 1,
    };
    expect(checkSpatialPartPlacement(chassis, { parts: [], routes: [] }, floatingShell)?.reason)
      .toBe('incompatible-stack');

    const reversed = structuredClone(build);
    reversed.parts.reverse();
    expect(validateWholeBuildPlacement(chassis, reversed)).toEqual([]);
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

  it('reports whether a heat-pipe path actually reaches a radiator', () => {
    const build = {
      chassisId: 'CH-5',
      parts: [
        { instanceId: 'reactor', partId: 'R-E25', origin: { regionId: 'body', x: 0, y: 3 }, rotation: 0 as const, integrity: 1 },
        { instanceId: 'radiator', partId: 'U-RAD', origin: { regionId: 'left-shoulder', x: 0, y: 1 }, rotation: 0 as const, integrity: 1 },
      ],
      routes: [{ kind: 'coolant' as const, regionId: 'body', x: 1, y: 2 }],
      powerPriority: [],
    };
    const linked = resolveThermalPaths(chassis, build);
    expect(linked.radiatorLinkedCoolantCells.has('body:1,2')).toBe(true);
    expect(linked.radiatorLinkedInstanceIds.has('reactor')).toBe(true);

    build.parts = build.parts.filter((part) => part.instanceId !== 'radiator');
    const isolated = resolveThermalPaths(chassis, build);
    expect(isolated.isolatedCoolantCells.has('body:1,2')).toBe(true);
  });

  it('resolves location, stack, cooling, and exposure from one shared placement result', () => {
    const build = demo();
    const effects = resolvePlacementEffects(chassis, build, 'mg');

    expect(effects?.regionNames).toEqual(['Left shoulder']);
    expect(effects?.location.effects.map((effect) => effect.id)).toEqual(['articulated-shoulder']);
    expect(effects?.location.weaponArcBonusDeg).toBe(25);
    expect(effects?.supportArcBonusDeg).toBe(25);
    expect(effects?.effectiveWeaponArcDeg).toBe(140);
    expect(effects?.armourHeatMultiplier).toBe(1.25);
    expect(effects?.passiveCoolingCellCount).toBe(0);
    expect(effects?.stackAboveInstanceIds).toEqual(['shell']);
    expect(effects?.stackBelowInstanceIds).toEqual(['turret']);
    expect(effects?.exposure.front).toEqual({ directCellCount: 0, protectedCellCount: 2 });

    const combatant = new Combatant(build, { x: 0, y: 0 }, 0);
    expect(combatant.weaponArcDeg('mg', getPart('W-MG').weapon!.mountArcDeg)).toBe(140);
  });

  it('stops destroyed armour from sealing or protecting the payload beneath it', () => {
    const build = demo();
    build.parts.find((part) => part.instanceId === 'shell')!.integrity = 0;
    const effects = resolvePlacementEffects(chassis, build, 'mg');

    expect(effects?.armourHeatMultiplier).toBe(1);
    expect(effects?.passiveCoolingCellCount).toBe(2);
    expect(effects?.exposure.front).toEqual({ directCellCount: 2, protectedCellCount: 0 });
  });

  it('updates sealed cooling and thermal bridges when equipment is destroyed', () => {
    const armoured = new Simulation(chassis, demo());
    const weaponCells = armoured.thermal.cellKeysByInstance.get('mg') ?? [];
    expect(weaponCells.every((key) => armoured.thermal.cells.get(key)?.passiveCoolingBlocked)).toBe(true);

    armoured.destroyPart('shell');
    expect(weaponCells.every((key) => !armoured.thermal.cells.get(key)?.passiveCoolingBlocked)).toBe(true);

    const bridgeBuild = {
      chassisId: 'CH-5',
      parts: [
        { instanceId: 'left-manifold', partId: 'U-PIPE', origin: { regionId: 'left-shoulder', x: 2, y: 1 }, rotation: 0 as const, integrity: 1 },
        { instanceId: 'body-manifold', partId: 'U-PIPE', origin: { regionId: 'body', x: 1, y: 2 }, rotation: 0 as const, integrity: 1 },
      ],
      routes: [],
      powerPriority: [],
    };
    const bridged = new Simulation(chassis, bridgeBuild);
    const leftCells = new Set(bridged.thermal.cellKeysByInstance.get('left-manifold'));
    expect(bridged.thermal.edges.some((edge) =>
      leftCells.has(edge.aKey) || leftCells.has(edge.bKey))).toBe(true);

    bridged.destroyPart('left-manifold');
    expect(bridged.thermal.edges.some((edge) =>
      leftCells.has(edge.aKey) || leftCells.has(edge.bKey))).toBe(false);
  });

  it('treats a separated regional edge as exterior for equipment cooling', () => {
    const bridge: PlacedPart = {
      instanceId: 'bridge', partId: 'U-CON',
      origin: { regionId: 'left-shoulder', x: 2, y: 1 }, rotation: 0, integrity: 1,
    };
    const thermal = buildThermalModel(chassis, [bridge]);
    expect(thermal.cells.get('2,1')?.isPerimeter).toBe(true);
  });

  it('supports authored range and heat zones without putting bonuses on reusable parts', () => {
    const weapon: PlacedPart = {
      instanceId: 'weapon', partId: 'W-MG',
      origin: { regionId: 'left-shoulder', x: 1, y: 0 }, rotation: 0, integrity: 1,
    };
    const custom = structuredClone(chassis);
    custom.locationZones!.push({
      id: 'test-zone',
      cells: [
        { regionId: 'left-shoulder', x: 1, y: 0 },
        { regionId: 'left-shoulder', x: 2, y: 0 },
      ],
      effect: {
        id: 'test-tradeoff', name: 'Test tradeoff', description: 'Test only',
        weaponRangeMultiplier: 0.95, heatMultiplier: 1.1,
      },
    });
    const effects = locationEffectsForPart(custom, weapon);
    expect(effects.weaponArcBonusDeg).toBe(25);
    expect(effects.weaponRangeMultiplier).toBeCloseTo(0.95);
    expect(effects.heatMultiplier).toBeCloseTo(1.1);
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

describe('component height (docs/superpowers/specs/2026-08-24-component-height-design.md)', () => {
  it('defaults an unauthored part to one level and no imposed clearance', () => {
    expect(partHeight(getPart('U-AMMO'))).toBe(1);
    expect(forwardClearance(getPart('U-AMMO'))).toBeUndefined();
  });

  it('stands the big guns three levels tall, clearing one level ahead', () => {
    for (const id of ['W-AC', 'W-RG', 'W-BR', 'W-LAS', 'W-RKT', 'W-ION']) {
      expect(partHeight(getPart(id)), id).toBe(3);
      expect(forwardClearance(getPart(id)), id).toBe(1);
    }
  });

  it('sits the small guns low, and lets nothing at all stand in front of them', () => {
    for (const id of ['W-MG', 'W-CB', 'W-SC']) {
      expect(partHeight(getPart(id)), id).toBe(1);
      expect(forwardClearance(getPart(id)), id).toBe(0);
    }
  });

  it('gives reactors and capacitors two levels, and armour none at all', () => {
    expect(partHeight(getPart('R-C40'))).toBe(2);
    expect(partHeight(getPart('P-CAP'))).toBe(2);
    expect(partHeight(getPart('U-ARM'))).toBe(0);
    expect(partHeight(getPart('U-SHELL'))).toBe(0);
  });
});

describe('cell ceilings', () => {
  const chassis = getChassis('CH-5'); // Mule, 6x6, body mask rows 2-5
  const cell = (x: number, y: number) => ({ regionId: 'body', x, y });
  const occ = (parts: PlacedPart[]) => buildSpatialOccupancy(chassis, { parts, routes: [] });

  const gun: PlacedPart = {
    instanceId: 'gun', partId: 'W-AC', origin: cell(1, 3), rotation: 0, integrity: 1,
  };

  it('is unbounded where nothing imposes one', () => {
    expect(cellCeiling(chassis, occ([]), cell(1, 2))).toBe(Infinity);
  });

  it('is lowered to a gun clearance in the gun own lane, ahead of it only', () => {
    // W-AC is rect(2,3) at body (1,3): it fills x 1-2, y 3-5.
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, cell(1, 2))).toBe(1);
    expect(cellCeiling(chassis, o, cell(2, 2))).toBe(1);
    // Not in its lanes:
    expect(cellCeiling(chassis, o, cell(3, 2))).toBe(Infinity);
  });

  it('never lets a gun block itself', () => {
    // Excluding the gun is what makes its own front cells placeable.
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, cell(1, 3), 'gun')).toBe(Infinity);
    expect(cellCeiling(chassis, o, cell(1, 4), 'gun')).toBe(Infinity);
  });

  it('does not cross a region seam', () => {
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, { regionId: 'left-shoulder', x: 1, y: 1 })).toBe(Infinity);
  });

  it('reads a stack base from what is already underneath', () => {
    const sink: PlacedPart = {
      instanceId: 'sink', partId: 'U-HS', origin: cell(1, 2), rotation: 0, integrity: 1,
    };
    const o = occ([sink]);
    expect(occupantTop(chassis, o, cell(1, 2), 'sink')).toBe(1);
    expect(stackBase(chassis, o, cell(1, 2), getPart('U-ARM'))).toBe(1);
    expect(stackBase(chassis, o, cell(1, 2), getPart('U-ARM'), 'sink')).toBe(0);
  });
});

describe('placement under a ceiling', () => {
  const bastion = getChassis('CH-9'); // Bastion: hull is x 2-5, y 0-8, core at (2,4)
  const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart =>
    ({ instanceId, partId, origin: { regionId: 'hull', x, y }, rotation: 0, integrity: 1 });
  const check = (parts: PlacedPart[], candidate: PlacedPart) =>
    checkSpatialPartPlacement(bastion, { parts, routes: [] }, candidate);

  // W-AC is rect(2,3): at (4,5) it fills x 4-5, y 5-7, and clears 1 level ahead.
  const gun = at('gun', 'W-AC', 4, 5);

  it('accepts a flat part in front of a gun', () => {
    // U-AMMO is line(2): one level tall, so it fits under a ceiling of 1.
    expect(check([gun], at('ammo', 'U-AMMO', 4, 3))).toBeNull();
  });

  it('refuses a two-level reactor in front of a gun', () => {
    // R-E25 is rect(2,2) and two levels tall.
    expect(check([gun], at('reactor', 'R-E25', 4, 2))?.reason).toBe('ceiling-exceeded');
  });

  it('refuses the gun when the reactor got there first', () => {
    expect(check([at('reactor', 'R-E25', 4, 2)], gun)?.reason).toBe('blocks-firing-lane');
  });

  it('leaves a gun placeable on an empty chassis, so it never blocks itself', () => {
    // The gun occupies three cells in its own lane. Without excluding itself,
    // its rear cells impose a ceiling of 1 on its front cells and no gun is
    // ever placeable anywhere.
    expect(check([], gun)).toBeNull();
  });

  it('ignores a tall part behind the gun', () => {
    const forward = at('gun', 'W-AC', 4, 4); // fills y 4-6
    expect(check([forward], at('reactor', 'R-E25', 4, 7))).toBeNull();
  });

  it('lets a small gun clear nothing at all in its lane', () => {
    // W-MG is one level tall and clears 0: even a heat sink is in the way.
    const mg = at('mg', 'W-MG', 4, 5);
    expect(check([mg], at('sink', 'U-HS', 4, 3))?.reason).toBe('ceiling-exceeded');
    expect(check([at('sink', 'U-HS', 4, 3)], mg)?.reason).toBe('blocks-firing-lane');
  });

  it('lets armour cover a part that is already at the ceiling', () => {
    // U-SHELL is line(2), armour layer, height 0: it skins the ammo bin without
    // raising it, so the bin stays legal under the gun's ceiling of 1.
    const ammo = at('ammo', 'U-AMMO', 4, 3);
    expect(check([gun, ammo], at('shell', 'U-SHELL', 4, 3))).toBeNull();
  });
});
