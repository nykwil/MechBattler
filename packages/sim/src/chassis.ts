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

// CH-7 Ridgeline. Deliberately square (7x7, aspect 1.00) even though a long
// narrow frame would be measurably harder to hit: `projectedHalfWidthM` mixes
// half-length and half-width by facing, but docs/17 F74 measured mechs at
// 0-15 degrees off nose-on for **100%** of sampled frames, so only `width` ever
// reaches the hit model and `height` is free cells. Until facing varies, aspect
// ratio is an unpriced stat rather than a trade, and a tall thin chassis would
// be strictly best rather than different.
const ridgelineMask = maskFromRows([
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
]);

// The spine is a full 3x7 block, and that is the whole point of the frame: it
// is the only zone in the catalog that is both three cells wide and deep enough
// to swallow a 2x5 gun, so it is the first place `W-SR` and `W-RG` can sit
// *wholly inside* a zone and claim its effect. The Vulture's hardpoints are too
// narrow and the Bastion's hull offers heat rather than reach.
const ridgelineSpineMask = maskFromRows([
  '..###..',
  '..###..',
  '..###..',
  '..###..',
  '..###..',
  '..###..',
  '..###..',
]);
const ridgelineLeftMask = maskFromRows([
  '.......',
  '.#.....',
  '##.....',
  '##.....',
  '##.....',
  '.#.....',
  '.......',
]);
const ridgelineRightMask = maskFromRows([
  '.......',
  '.....#.',
  '.....##',
  '.....##',
  '.....##',
  '.....#.',
  '.......',
]);

export const CHASSIS: Record<string, ChassisSpec> = {
  'CH-2': {
    id: 'CH-2', name: 'Vulture', type: 'Scout biped',
    width: 5, height: 4, mask: vultureMask, coreCell: { regionId: 'body', x: 2, y: 1 },
    // Strafe 3.0 -> 6.0 and rev 2.5 -> 4.5, Aug 2026. Evasion in the hit model
    // is lead error, which only comes from *lateral* speed, and the autopilot
    // only generates it by orbiting at `strafe`. The scout shipped with the
    // worst strafe:fwd ratio of the three chassis (0.33 against the Mule's
    // 0.67), so its whole speed advantage sat in closing — the one vector that
    // produces no evasion — and it measured 0.5 m/s lateral against a 9 m/s
    // top speed. It was the fastest chassis and the worst at using speed.
    ratedMassT: 3.0, chassisTier: 1, speedsMps: { fwd: 9.0, strafe: 6.0, rev: 4.5 },
    turnRateDegS: 150, accelMps2: 4.0,
    chassisHitTickets: 6, maxIntegrity: 240, moveJitterMult: 0.35,
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
    ratedMassT: 6.0, chassisTier: 2, speedsMps: { fwd: 6.0, strafe: 4.0, rev: 3.0 },
    turnRateDegS: 90, accelMps2: 3.0,
    chassisHitTickets: 10, maxIntegrity: 320, moveJitterMult: 1,
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
    clearanceZones: [{
      id: 'mule-cargo-bay',
      name: 'Cargo bay',
      cells: [1, 2, 3, 4].map((x) => ({ regionId: 'body', x, y: 5 })),
      height: 1,
    }],
  },
  'CH-7': {
    id: 'CH-7', name: 'Ridgeline', type: 'Line quad',
    width: 7, height: 7, mask: ridgelineMask,
    // At the spine's LEFT EDGE, not its centre. Authored at (3,3) first, which
    // is dead centre of a 7x7 grid, and every 2-wide gun long enough to be worth
    // the spine then crossed it: `W-RG` was refused `core-occupied` at all six
    // origins the grid otherwise accepted, so the frame authored to home the
    // dead railgun could not mount it. The Mule (2,2 in a body spanning 0-5) and
    // the Bastion (2,4 in a hull spanning 2-5) both edge their cores for the same
    // reason. The core's *column* is what decides whether a wide gun can run the
    // frame's length. docs/17 F74.
    coreCell: { regionId: 'spine', x: 2, y: 3 },
    // chassisTier 3 was the one empty rung: the catalog shipped 1, 2 and 4, and
    // rated mass doubles across them (3.0 / 6.0 / 12.0 t), so the missing frame
    // is a 9-tonne one. Everything below interpolates between the Mule and the
    // Bastion rather than inventing a new axis -- the identity is the spine, not
    // the statline.
    ratedMassT: 9.0, chassisTier: 3, speedsMps: { fwd: 5.0, strafe: 2.5, rev: 2.0 },
    turnRateDegS: 65, accelMps2: 2.2,
    chassisHitTickets: 14, maxIntegrity: 480, moveJitterMult: 1,
    regions: [
      {
        id: 'left-sponson', name: 'Left sponson', width: 7, height: 7,
        mask: ridgelineLeftMask, workshopOrigin: { x: 0, y: 0 },
      },
      {
        id: 'spine', name: 'Spine', width: 7, height: 7,
        mask: ridgelineSpineMask, workshopOrigin: { x: 2, y: 2 },
      },
      {
        id: 'right-sponson', name: 'Right sponson', width: 7, height: 7,
        mask: ridgelineRightMask, workshopOrigin: { x: 7, y: 0 },
      },
    ],
    ports: [
      {
        id: 'left-sponson-forward-joint',
        a: { regionId: 'left-sponson', x: 1, y: 2 },
        b: { regionId: 'spine', x: 2, y: 2 },
      },
      {
        id: 'left-sponson-aft-joint',
        a: { regionId: 'left-sponson', x: 1, y: 4 },
        b: { regionId: 'spine', x: 2, y: 4 },
      },
      {
        id: 'right-sponson-forward-joint',
        a: { regionId: 'spine', x: 4, y: 2 },
        b: { regionId: 'right-sponson', x: 5, y: 2 },
      },
      {
        id: 'right-sponson-aft-joint',
        a: { regionId: 'spine', x: 4, y: 4 },
        b: { regionId: 'right-sponson', x: 5, y: 4 },
      },
    ],
    locationZones: [{
      id: 'ridgeline-ranging-spine',
      cells: cellsFromMask('spine', ridgelineSpineMask),
      effect: {
        id: 'ranging-spine',
        name: 'Ranging spine',
        description: 'Weapons fitted wholly in the spine gain 15% range.',
        weaponRangeMultiplier: 1.15,
      },
    }],
  },
  'CH-9': {
    id: 'CH-9', name: 'Bastion', type: 'Assault biped',
    width: 8, height: 9, mask: bastionMask, coreCell: { regionId: 'hull', x: 2, y: 4 },
    ratedMassT: 12.0, chassisTier: 4, speedsMps: { fwd: 4.0, strafe: 1.5, rev: 1.2 },
    turnRateDegS: 45, accelMps2: 1.5,
    chassisHitTickets: 18, maxIntegrity: 700, moveJitterMult: 1,
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
