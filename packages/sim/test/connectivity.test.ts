import { describe, expect, it } from 'vitest';
import { getChassis } from '../src/chassis.js';
import { computeConnectivity, computeCoreNetwork } from '../src/grid.js';
import type { PlacedPart } from '../src/types.js';

/**
 * docs/01-chassis-grid-spec.md §3: "a part is connected if it is
 * edge-adjacent to a reactor, or edge-adjacent to a conduit that has a
 * conduit-path back to a reactor."
 */
describe('power connectivity', () => {
  const chassis = getChassis('CH-2'); // Vulture, 5x4, core at (2,1)

  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 0, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'conduit1', partId: 'U-CON', origin: { x: 2, y: 2 }, rotation: 0, integrity: 1 },
    { instanceId: 'conduit2', partId: 'U-CON', origin: { x: 3, y: 2 }, rotation: 0, integrity: 1 },
    { instanceId: 'armor-connected', partId: 'U-ARM', origin: { x: 4, y: 2 }, rotation: 0, integrity: 1 },
    { instanceId: 'armor-unconnected', partId: 'U-ARM', origin: { x: 2, y: 0 }, rotation: 0, integrity: 1 },
  ];

  it('propagates connectivity through a conduit chain', () => {
    const { connectedInstanceIds } = computeConnectivity(parts);
    expect(connectedInstanceIds.has('reactor')).toBe(true);
    expect(connectedInstanceIds.has('conduit1')).toBe(true);
    expect(connectedInstanceIds.has('conduit2')).toBe(true);
    expect(connectedInstanceIds.has('armor-connected')).toBe(true);
  });

  it('does not connect a part only adjacent to the (non-propagating) core', () => {
    const { connectedInstanceIds } = computeConnectivity(parts);
    expect(connectedInstanceIds.has('armor-unconnected')).toBe(false);
  });

  it('finds the core network when the core is adjacent to the reactor', () => {
    // Core (2,1) is adjacent to reactor cell (1,1).
    const networkId = computeCoreNetwork(chassis, parts);
    expect(networkId).not.toBeNull();
  });

  it('leaves the core unpowered if nothing bridges it to a reactor', () => {
    const isolatedParts = parts.filter((p) => p.instanceId !== 'reactor');
    const networkId = computeCoreNetwork(chassis, isolatedParts);
    expect(networkId).toBeNull();
  });
});
