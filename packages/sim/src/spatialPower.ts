import type { Build, ChassisSpec, PartDef } from './types.js';
import { getPart } from './catalog.js';
import {
  WIRE_CAPACITY_KW,
  buildSpatialOccupancy,
  equipmentLayer,
  spatialCellKey,
} from './spatial.js';
import { CORE_INSTANCE_ID } from './thermal.js';

export interface SpatialPowerNetwork {
  networkId: string;
  reactorInstanceIds: string[];
  memberInstanceIds: string[];
  /** Widest available path from a source to each consumer. */
  capacityKwByInstance: Record<string, number>;
}

export interface SpatialPowerResolution {
  networks: SpatialPowerNetwork[];
  connectedInstanceIds: Set<string>;
  energizedWireCells: Set<string>;
  unconnectedInstanceIds: string[];
  coreNetworkId: string | null;
  bottleneckInstanceIds: string[];
}

interface Edge { to: string; capacityKw: number }

function partCanTransfer(def: PartDef): boolean {
  return def.spatial?.transfersPower !== false;
}

function partCapacity(def: PartDef): number {
  return def.spatial?.electricalCapacityKw ?? WIRE_CAPACITY_KW;
}

function addEdge(graph: Map<string, Edge[]>, a: string, b: string, capacityKw: number): void {
  if (capacityKw <= 0) return;
  const aEdges = graph.get(a) ?? [];
  aEdges.push({ to: b, capacityKw });
  graph.set(a, aEdges);
  const bEdges = graph.get(b) ?? [];
  bEdges.push({ to: a, capacityKw });
  graph.set(b, bEdges);
}

function projectedNeighborKey(regionId: string, x: number, y: number): string {
  return `${regionId}:${x},${y}`;
}

/**
 * Regional wire/equipment graph. Every fitted component conducts the standard
 * bus capacity unless it explicitly opts out; support/payload stacks and port
 * links are authored topology, never geometric accidents across seams.
 */
export function resolveSpatialPower(
  chassis: ChassisSpec,
  build: Build,
  activeIds = new Set(build.parts.map((part) => part.instanceId)),
): SpatialPowerResolution {
  const occupancy = buildSpatialOccupancy(chassis, {
    parts: build.parts.filter((part) => activeIds.has(part.instanceId)),
    routes: build.routes,
  });
  const graph = new Map<string, Edge[]>();
  const partNode = (id: string) => `part:${id}`;
  const wireNode = (key: string) => `wire:${key}`;

  const partById = new Map(build.parts.map((part) => [part.instanceId, part]));
  const cellsForPart = occupancy.cellsByInstance;

  for (const [key, kinds] of occupancy.routesByCell) {
    if (!kinds.has('wire')) continue;
    graph.set(wireNode(key), graph.get(wireNode(key)) ?? []);
    const [regionId, coords] = key.split(':');
    const [x, y] = coords!.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighborKey = projectedNeighborKey(regionId!, x! + dx, y! + dy);
      if (occupancy.routesByCell.get(neighborKey)?.has('wire')) {
        addEdge(graph, wireNode(key), wireNode(neighborKey), WIRE_CAPACITY_KW);
      }
      for (const occupant of occupancy.stacksByCell.get(neighborKey) ?? []) {
        const def = getPart(occupant.partId);
        addEdge(graph, wireNode(key), partNode(occupant.instanceId), Math.min(WIRE_CAPACITY_KW, partCapacity(def)));
      }
    }
  }

  // All edge-adjacent equipment joins inside a region. This makes fitted parts
  // the electrical structure; Bus is needed to cross empty cells.
  for (const placed of build.parts) {
    if (!activeIds.has(placed.instanceId)) continue;
    const def = getPart(placed.partId);
    graph.set(partNode(placed.instanceId), graph.get(partNode(placed.instanceId)) ?? []);
    for (const cell of cellsForPart.get(placed.instanceId) ?? []) {
      const cellKey = spatialCellKey(chassis, cell);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const neighborKey = projectedNeighborKey(cell.regionId, cell.x + dx, cell.y + dy);
        for (const neighbor of occupancy.stacksByCell.get(neighborKey) ?? []) {
          if (neighbor.instanceId === placed.instanceId) continue;
          const neighborDef = getPart(neighbor.partId);
          if (partCanTransfer(def) || partCanTransfer(neighborDef)) {
            addEdge(
              graph,
              partNode(placed.instanceId),
              partNode(neighbor.instanceId),
              Math.min(partCapacity(def), partCapacity(neighborDef)),
            );
          }
        }
      }
      // Same-cell functional stack transfer (support -> payload).
      const stack = occupancy.stacksByCell.get(cellKey) ?? [];
      const ownIndex = stack.findIndex((entry) => entry.instanceId === placed.instanceId);
      for (const neighbor of stack) {
        if (neighbor.instanceId === placed.instanceId) continue;
        const neighborDef = getPart(neighbor.partId);
        if (
          equipmentLayer(def) === 'support'
          || equipmentLayer(neighborDef) === 'support'
          || partCanTransfer(def)
          || partCanTransfer(neighborDef)
        ) {
          addEdge(
            graph,
            partNode(placed.instanceId),
            partNode(neighbor.instanceId),
            Math.min(partCapacity(def), partCapacity(neighborDef)),
          );
        }
      }
      void ownIndex;
    }
  }

  // Port cells are sockets beneath their occupant. Bus routes and conductive
  // equipment can bridge onward, while ordinary endpoint equipment (including
  // weapons) can draw directly from whatever energizes the linked endpoint.
  for (const port of chassis.ports ?? []) {
    const endpoint = (ref: typeof port.a): Array<{ node: string; capacityKw: number }> => {
      const key = spatialCellKey(chassis, ref);
      if (occupancy.routesByCell.get(key)?.has('wire')) {
        return [{ node: wireNode(key), capacityKw: WIRE_CAPACITY_KW }];
      }
      const stack = occupancy.stacksByCell.get(key) ?? [];
      return [...new Map(stack.map((entry) => [entry.instanceId, entry])).values()]
        .map((entry) => ({
          node: partNode(entry.instanceId),
          capacityKw: partCapacity(getPart(entry.partId)),
        }));
    };
    const a = endpoint(port.a);
    const b = endpoint(port.b);
    for (const aNode of a) {
      for (const bNode of b) {
        addEdge(
          graph,
          aNode.node,
          bNode.node,
          Math.min(WIRE_CAPACITY_KW, aNode.capacityKw, bNode.capacityKw),
        );
      }
    }
  }

  // Core is a leaf attached to same-region adjacent wires/conductive parts.
  const coreRegion = chassis.coreCell.regionId
    ?? chassis.regions?.find((region) => region.mask[chassis.coreCell.y]?.[chassis.coreCell.x])?.id
    ?? 'body';
  const coreNode = `core:${CORE_INSTANCE_ID}`;
  graph.set(coreNode, []);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const key = projectedNeighborKey(coreRegion, chassis.coreCell.x + dx, chassis.coreCell.y + dy);
    if (occupancy.routesByCell.get(key)?.has('wire')) addEdge(graph, coreNode, wireNode(key), WIRE_CAPACITY_KW);
    for (const occupant of occupancy.stacksByCell.get(key) ?? []) {
      if (partCanTransfer(getPart(occupant.partId))) {
        addEdge(graph, coreNode, partNode(occupant.instanceId), partCapacity(getPart(occupant.partId)));
      }
    }
  }

  const reactors = build.parts.filter((part) =>
    activeIds.has(part.instanceId) && getPart(part.partId).category === 'reactor');
  const networks: SpatialPowerNetwork[] = [];
  const connectedInstanceIds = new Set<string>();
  const energizedWireCells = new Set<string>();
  let coreNetworkId: string | null = null;

  // Each connected component containing reactors becomes one supply network.
  const assigned = new Set<string>();
  for (const reactor of reactors) {
    const start = partNode(reactor.instanceId);
    if (assigned.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (component.has(node)) continue;
      component.add(node);
      for (const edge of graph.get(node) ?? []) queue.push(edge.to);
    }
    const sourceIds = reactors.filter((candidate) => component.has(partNode(candidate.instanceId))).map((candidate) => candidate.instanceId);
    if (sourceIds.length === 0) continue;
    for (const node of component) assigned.add(node);

    // Widest-path capacity from any source.
    const widest = new Map<string, number>();
    const frontier: Array<{ node: string; width: number }> = sourceIds.map((id) => ({ node: partNode(id), width: Infinity }));
    while (frontier.length > 0) {
      frontier.sort((a, b) => b.width - a.width);
      const current = frontier.shift()!;
      if ((widest.get(current.node) ?? -1) >= current.width) continue;
      widest.set(current.node, current.width);
      for (const edge of graph.get(current.node) ?? []) {
        frontier.push({ node: edge.to, width: Math.min(current.width, edge.capacityKw) });
      }
    }

    const memberInstanceIds = build.parts
      .filter((part) => component.has(partNode(part.instanceId)) && !sourceIds.includes(part.instanceId))
      .map((part) => part.instanceId);
    const networkId = `spatial:${sourceIds.sort().join('+')}`;
    const capacityKwByInstance = Object.fromEntries(
      [...sourceIds, ...memberInstanceIds].map((id) => [id, widest.get(partNode(id)) ?? 0]),
    );
    networks.push({ networkId, reactorInstanceIds: sourceIds, memberInstanceIds, capacityKwByInstance });
    for (const id of [...sourceIds, ...memberInstanceIds]) connectedInstanceIds.add(id);
    for (const node of component) if (node.startsWith('wire:')) energizedWireCells.add(node.slice(5));
    if (component.has(coreNode)) coreNetworkId = networkId;
  }

  const unconnectedInstanceIds = build.parts
    .filter((part) => activeIds.has(part.instanceId) && !connectedInstanceIds.has(part.instanceId))
    .map((part) => part.instanceId);
  const bottleneckInstanceIds = networks.flatMap((network) =>
    network.memberInstanceIds.filter((id) => {
      const part = partById.get(id);
      const def = part && getPart(part.partId);
      const demand = def?.draw?.continuousKw ?? def?.draw?.maxChargeKw ?? 0;
      return demand > (network.capacityKwByInstance[id] ?? 0);
    }),
  );
  return {
    networks,
    connectedInstanceIds,
    energizedWireCells,
    unconnectedInstanceIds,
    coreNetworkId,
    bottleneckInstanceIds,
  };
}

export function usesSpatialSystems(build: Build): boolean {
  return Boolean(build.routes?.length || build.parts.some((part) => part.origin.regionId));
}
