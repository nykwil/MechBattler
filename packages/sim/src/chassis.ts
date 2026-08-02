/**
 * Chassis definitions. See docs/01-chassis-grid-spec.md §2.
 *
 * Masks are hand-authored ASCII silhouettes rather than a generated shape,
 * so each chassis reads as its intended archetype (biped / quad / spider /
 * assault). Usable cell counts land close to (not always exactly) the spec
 * table's illustrative numbers; docs/01 §10 already flags exact grid sizing
 * as something the prototype should validate, so small deviations here are
 * expected and fine.
 */
import type { ChassisSpec } from './types.js';

function maskFromRows(rows: string[]): boolean[][] {
  return rows.map((row) => row.split('').map((c) => c === '#'));
}

function usableCells(mask: boolean[][]): number {
  return mask.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}

function cellsFromMask(regionId: string, mask: boolean[][]) {
  return mask.flatMap((row, y) => row.flatMap((occupied, x) =>
    occupied ? [{ regionId, x, y }] : []));
}

const vultureMask = maskFromRows([
  '.###.',
  '#####',
  '#####',
  '.###.',
]);

const vultureLeftMask = maskFromRows([
  '.#...',
  '##...',
  '##...',
  '.#...',
]);
const vultureBodyMask = maskFromRows([
  '..#..',
  '..#..',
  '..#..',
  '..#..',
]);
const vultureRightMask = maskFromRows([
  '...#.',
  '...##',
  '...##',
  '...#.',
]);

const muleMask = maskFromRows([
  '.####.',
  '######',
  '######',
  '######',
  '######',
  '.####.',
]);

const muleLeftMask = maskFromRows([
  '.##...',
  '###...',
  '......',
  '......',
  '......',
  '......',
]);
const muleBodyMask = maskFromRows([
  '......',
  '......',
  '######',
  '######',
  '######',
  '.####.',
]);
const muleRightMask = maskFromRows([
  '...##.',
  '...###',
  '......',
  '......',
  '......',
  '......',
]);

const bastionMask = maskFromRows([
  '..####..',
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
  '..####..',
]);

const bastionLeftMask = maskFromRows([
  '........',
  '.#......',
  '##......',
  '##......',
  '##......',
  '##......',
  '.#......',
  '........',
  '........',
]);
const bastionHullMask = maskFromRows([
  '..####..',
  '..####..',
  '..####..',
  '..####..',
  '..####..',
  '..####..',
  '..####..',
  '..####..',
  '..####..',
]);
const bastionRightMask = maskFromRows([
  '........',
  '......#.',
  '......##',
  '......##',
  '......##',
  '......##',
  '......#.',
  '........',
  '........',
]);

export const CHASSIS: Record<string, ChassisSpec> = {
  'CH-2': {
    id: 'CH-2', name: 'Vulture', type: 'Scout biped',
    width: 5, height: 4, mask: vultureMask, coreCell: { regionId: 'body', x: 2, y: 1 },
    ratedMassT: 3.0, speedsMps: { fwd: 9.0, strafe: 3.0, rev: 2.5 },
    turnRateDegS: 150, accelMps2: 4.0,
    chassisHitTickets: 6, maxIntegrity: 240,
    regions: [
      {
        id: 'left-hardpoint', name: 'Left hardpoint', width: 5, height: 4,
        mask: vultureLeftMask, workshopOrigin: { x: 0, y: 0 },
      },
      {
        id: 'body', name: 'Body', width: 5, height: 4,
        mask: vultureBodyMask, workshopOrigin: { x: 3, y: 3 },
      },
      {
        id: 'right-hardpoint', name: 'Right hardpoint', width: 5, height: 4,
        mask: vultureRightMask, workshopOrigin: { x: 5, y: 0 },
      },
    ],
    ports: [
      {
        id: 'left-hardpoint-joint',
        a: { regionId: 'left-hardpoint', x: 1, y: 1 },
        b: { regionId: 'body', x: 2, y: 0 },
      },
      {
        id: 'right-hardpoint-joint',
        a: { regionId: 'body', x: 2, y: 2 },
        b: { regionId: 'right-hardpoint', x: 3, y: 2 },
      },
    ],
    locationZones: [{
      id: 'vulture-long-sight-hardpoints',
      cells: [
        ...cellsFromMask('left-hardpoint', vultureLeftMask),
        ...cellsFromMask('right-hardpoint', vultureRightMask),
      ],
      effect: {
        id: 'long-sight-hardpoint',
        name: 'Long-sight hardpoint',
        description: 'Weapons fitted wholly in a hardpoint gain 10% range.',
        weaponRangeMultiplier: 1.1,
      },
    }],
  },
  'CH-5': {
    id: 'CH-5', name: 'Mule', type: 'Quad',
    width: 6, height: 6, mask: muleMask, coreCell: { regionId: 'body', x: 2, y: 2 },
    ratedMassT: 6.0, speedsMps: { fwd: 6.0, strafe: 4.0, rev: 3.0 },
    turnRateDegS: 90, accelMps2: 3.0,
    chassisHitTickets: 10, maxIntegrity: 320,
    regions: [
      {
        id: 'left-shoulder', name: 'Left shoulder', width: 6, height: 6,
        mask: muleLeftMask, workshopOrigin: { x: 0, y: 0 },
      },
      {
        id: 'body', name: 'Body', width: 6, height: 6,
        mask: muleBodyMask, workshopOrigin: { x: 0, y: 3 },
        workshopOffset: { x: 0.5, y: 0 },
      },
      {
        id: 'right-shoulder', name: 'Right shoulder', width: 6, height: 6,
        mask: muleRightMask, workshopOrigin: { x: 4, y: 0 },
      },
    ],
    ports: [
      {
        id: 'left-shoulder-joint',
        a: { regionId: 'left-shoulder', x: 2, y: 1 },
        b: { regionId: 'body', x: 1, y: 2 },
      },
      {
        id: 'right-shoulder-joint',
        a: { regionId: 'body', x: 4, y: 2 },
        b: { regionId: 'right-shoulder', x: 3, y: 1 },
      },
    ],
    locationZones: [
      {
        id: 'mule-articulated-shoulders',
        cells: [
          ...cellsFromMask('left-shoulder', muleLeftMask),
          ...cellsFromMask('right-shoulder', muleRightMask),
        ],
        effect: {
          id: 'articulated-shoulder',
          name: 'Articulated shoulder',
          description: 'Weapons fitted wholly in a shoulder gain +25 degrees of targeting arc.',
          weaponArcBonusDeg: 25,
        },
      },
    ],
  },
  'CH-9': {
    id: 'CH-9', name: 'Bastion', type: 'Assault biped',
    width: 8, height: 9, mask: bastionMask, coreCell: { regionId: 'hull', x: 2, y: 4 },
    ratedMassT: 12.0, speedsMps: { fwd: 4.0, strafe: 1.5, rev: 1.2 },
    turnRateDegS: 45, accelMps2: 1.5,
    chassisHitTickets: 18, maxIntegrity: 700,
    regions: [
      {
        id: 'left-sponson', name: 'Left sponson', width: 8, height: 9,
        mask: bastionLeftMask, workshopOrigin: { x: 0, y: 0 },
      },
      {
        id: 'hull', name: 'Hull', width: 8, height: 9,
        mask: bastionHullMask, workshopOrigin: { x: 3, y: 3 },
      },
      {
        id: 'right-sponson', name: 'Right sponson', width: 8, height: 9,
        mask: bastionRightMask, workshopOrigin: { x: 8, y: 0 },
      },
    ],
    ports: [
      {
        id: 'left-sponson-forward-joint',
        a: { regionId: 'left-sponson', x: 1, y: 2 },
        b: { regionId: 'hull', x: 2, y: 2 },
      },
      {
        id: 'left-sponson-aft-joint',
        a: { regionId: 'left-sponson', x: 1, y: 5 },
        b: { regionId: 'hull', x: 2, y: 5 },
      },
      {
        id: 'right-sponson-forward-joint',
        a: { regionId: 'hull', x: 5, y: 2 },
        b: { regionId: 'right-sponson', x: 6, y: 2 },
      },
      {
        id: 'right-sponson-aft-joint',
        a: { regionId: 'hull', x: 5, y: 5 },
        b: { regionId: 'right-sponson', x: 6, y: 5 },
      },
    ],
    locationZones: [{
      id: 'bastion-heat-spreader-casemate',
      cells: cellsFromMask('hull', bastionHullMask),
      effect: {
        id: 'heat-spreader-casemate',
        name: 'Heat-spreader casemate',
        description: 'Equipment fitted wholly in the hull generates 15% less heat.',
        heatMultiplier: 0.85,
      },
    }],
  },
};

export function getChassis(id: string): ChassisSpec {
  const chassis = CHASSIS[id];
  if (!chassis) throw new Error(`Unknown chassis id: ${id}`);
  return chassis;
}

export function getUsableCellCount(chassis: ChassisSpec): number {
  return usableCells(chassis.mask);
}

/** Region owning a projected workshop cell. Flat chassis use the implicit `body`. */
export function regionIdAt(chassis: ChassisSpec, x: number, y: number): string | null {
  if (!chassis.mask[y]?.[x]) return null;
  if (!chassis.regions) return 'body';
  return chassis.regions.find((region) => region.mask[y]?.[x])?.id ?? null;
}
