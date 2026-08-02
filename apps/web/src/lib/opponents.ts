/**
 * Canned opponent roster for the arena panel. Layouts are hand-verified
 * against the chassis masks in the sim (same builds the sim's combat tests
 * exercise). Presented as intel cards per docs/04 §5: name, chassis type,
 * a couple of confirmed parts, and a threat rating.
 */
import { TEMPLATES, type Build } from '@mechbattler/sim';

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

function templateBuild(id: string): Build {
  const template = TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown opponent template ${id}`);
  return structuredClone(template.build);
}

function muleGunline(): Build {
  return templateBuild('mule-gunline');
}

function overseerMule(): Build {
  const build = templateBuild('mule-gunline');
  build.parts.push({
    instanceId: 'tc', partId: 'U-TC1',
    origin: { regionId: 'right-shoulder', x: 3, y: 1 }, rotation: 0, integrity: 1,
  });
  build.powerPriority.push('tc');
  return build;
}

export const OPPONENTS: OpponentDef[] = [
  {
    id: 'junkyard-vulture',
    name: 'Junkyard Vulture',
    blurb: 'Scout biped — long-sight hardpoints reward keeping its distance.',
    threat: 1,
    confirmed: ['W-CB Needle', 'R-E25 Whisper'],
    build: templateBuild('vulture-skirmisher'),
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
