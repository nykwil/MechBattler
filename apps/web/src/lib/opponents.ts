/**
 * Canned opponent roster for the arena panel. Layouts are hand-verified
 * against the chassis masks in the sim (same builds the sim's combat tests
 * exercise). Presented as intel cards per docs/04 §5: name, chassis type,
 * a couple of confirmed parts, and a threat rating.
 */
import { CORE_INSTANCE_ID, type Build, type PlacedPart } from '@mechbattler/sim';

export interface OpponentDef {
  id: string;
  name: string;
  blurb: string;
  /** 1-3, purely informational. */
  threat: 1 | 2 | 3;
  /** "Confirmed parts" shown on the intel card (docs/04 §5). */
  confirmed: string[];
  build: Build;
  // --- Ladder extras (docs/10 M4; absent on the canned free-play roster) ----
  /** Elite node flavor: bigger budget, purse × ELITE_PURSE_MULT. */
  elite?: boolean;
  /** Fixed battle seed — the scouted arena is the fought arena. */
  battleSeed?: number;
  spawnDistanceM?: number;
  chassisLabel?: string;
  /** Highest-tier weapon name, for the intel headline warning. */
  headline?: string | null;
  /** Elite mod carrier telegraph, e.g. "Tidecooler Gill" (docs/04 §4b). */
  carries?: string;
}

function junkyardWidow(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 4, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 4, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'mg1', partId: 'W-MG', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 3, y: 0 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-7', parts, powerPriority: [CORE_INSTANCE_ID, 'mg1'] };
}

function muleGunline(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac'] };
}

function overseerMule(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'tc', partId: 'U-TC1', origin: { x: 4, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac', 'tc'] };
}

export const OPPONENTS: OpponentDef[] = [
  {
    id: 'junkyard-widow',
    name: 'Junkyard Widow',
    blurb: 'Spider chassis — orbits inside its band. Light guns, hard to pin.',
    threat: 1,
    confirmed: ['W-MG Stitcher', 'R-E25 Whisper'],
    build: junkyardWidow(),
  },
  {
    id: 'mule-gunline',
    name: 'Mule Gunline',
    blurb: 'Quad with an autocannon and a combustion plant. Wants a firing line.',
    threat: 2,
    confirmed: ['W-AC Judge', 'R-C40 Lump'],
    build: muleGunline(),
  },
  {
    id: 'overseer-mule',
    name: 'Overseer Mule',
    blurb: 'Gunline with a targeting computer — strafing it does not work.',
    threat: 3,
    confirmed: ['W-AC Judge', 'U-TC1 Abacus'],
    build: overseerMule(),
  },
];
