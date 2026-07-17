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

const vultureMask = maskFromRows([
  '.###.',
  '#####',
  '#####',
  '.###.',
]);

const muleMask = maskFromRows([
  '.####.',
  '######',
  '######',
  '######',
  '######',
  '.####.',
]);

const widowMask = maskFromRows([
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
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

export const CHASSIS: Record<string, ChassisSpec> = {
  'CH-2': {
    id: 'CH-2', name: 'Vulture', type: 'Scout biped',
    width: 5, height: 4, mask: vultureMask, coreCell: { x: 2, y: 1 },
    ratedMassT: 3.0, speedsMps: { fwd: 9.0, strafe: 3.0, rev: 2.5 },
    turnRateDegS: 150, accelMps2: 4.0,
  },
  'CH-5': {
    id: 'CH-5', name: 'Mule', type: 'Quad',
    width: 6, height: 6, mask: muleMask, coreCell: { x: 2, y: 2 },
    ratedMassT: 6.0, speedsMps: { fwd: 6.0, strafe: 4.0, rev: 3.0 },
    turnRateDegS: 90, accelMps2: 3.0,
  },
  'CH-7': {
    id: 'CH-7', name: 'Widow', type: 'Spider',
    width: 7, height: 7, mask: widowMask, coreCell: { x: 3, y: 3 },
    ratedMassT: 7.0, speedsMps: { fwd: 5.0, strafe: 4.5, rev: 4.5 },
    turnRateDegS: 120, accelMps2: 3.0,
  },
  'CH-9': {
    id: 'CH-9', name: 'Bastion', type: 'Assault biped',
    width: 8, height: 9, mask: bastionMask, coreCell: { x: 3, y: 3 },
    ratedMassT: 12.0, speedsMps: { fwd: 4.0, strafe: 1.5, rev: 1.2 },
    turnRateDegS: 45, accelMps2: 1.5,
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
