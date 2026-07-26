import {
  STATIC_CTX,
  TEMPLATES,
  computeSpeedProfile,
  effectiveMults,
  getChassis,
  getOccupiedCells,
  getPart,
  type Build,
  type PartCategory,
} from '@mechbattler/sim';

export type Vec3Tuple = [number, number, number];
export type GaitKind = 'biped' | 'quad';

export interface PhysicalPart {
  instanceId: string;
  partId: string;
  name: string;
  category: PartCategory;
  massT: number;
  localPositionM: Vec3Tuple;
  localSizeM: Vec3Tuple;
  recoilKnS?: number;
  stressOnly?: boolean;
}

export interface LegRigConfig {
  gait: GaitKind;
  upperLengthM: number;
  lowerLengthM: number;
  stepHeightM: number;
  stepDurationS: number;
  hipOffsetsM: Vec3Tuple[];
  neutralFeetM: Vec3Tuple[];
  stepGroups: number[][];
}

export interface PhysicalMechDescription {
  id: string;
  name: string;
  chassisId: string;
  structuralMassT: number;
  totalMassT: number;
  payloadMassT: number;
  ratedMassT: number;
  loadRatio: number;
  bodySizeM: Vec3Tuple;
  centerOfMassLocalM: Vec3Tuple;
  parts: PhysicalPart[];
  legRig: LegRigConfig;
  locomotion: {
    maxSpeedMps: number;
    accelMps2: number;
    turnRateDegS: number;
  };
}

export interface PrototypeLoadout {
  id: string;
  name: string;
  blurb: string;
  build: Build;
  gait: GaitKind;
  stressParts?: PhysicalPart[];
  featured?: boolean;
}

const CELL_M = 0.5;

function categoryHeight(category: PartCategory): number {
  switch (category) {
    case 'weapon': return 0.38;
    case 'reactor': return 0.52;
    case 'capacitor': return 0.34;
    case 'utility': return 0.24;
    case 'structural': return 0.18;
  }
}

function makeLegRig(gait: GaitKind, body: Vec3Tuple): LegRigConfig {
  const [width, , depth] = body;
  if (gait === 'biped') {
    const hipX = Math.max(0.42, width * 0.3);
    const footX = Math.max(0.58, width * 0.42);
    return {
      gait,
      upperLengthM: 0.86,
      lowerLengthM: 0.92,
      stepHeightM: 0.3,
      stepDurationS: 0.34,
      hipOffsetsM: [[-hipX, -0.22, 0], [hipX, -0.22, 0]],
      neutralFeetM: [[-footX, 0, 0.08], [footX, 0, -0.08]],
      stepGroups: [[0], [1]],
    };
  }

  const hipX = Math.max(0.54, width * 0.42);
  const hipZ = Math.max(0.46, depth * 0.36);
  const footX = hipX + 0.26;
  const footZ = hipZ + 0.2;
  return {
    gait,
    upperLengthM: 0.68,
    lowerLengthM: 0.72,
    stepHeightM: 0.24,
    stepDurationS: 0.3,
    hipOffsetsM: [
      [-hipX, -0.18, hipZ],
      [hipX, -0.18, hipZ],
      [-hipX, -0.18, -hipZ],
      [hipX, -0.18, -hipZ],
    ],
    neutralFeetM: [
      [-footX, 0, footZ],
      [footX, 0, footZ],
      [-footX, 0, -footZ],
      [footX, 0, -footZ],
    ],
    stepGroups: [[0, 3], [1, 2]],
  };
}

function buildParts(build: Build, bodyHeight: number): PhysicalPart[] {
  const chassis = getChassis(build.chassisId);
  return build.parts.map((placed) => {
    const def = getPart(placed.partId);
    const cells = getOccupiedCells(placed, def);
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const height = categoryHeight(def.category);
    const width = Math.max(0.22, (maxX - minX + 1) * CELL_M * 0.88);
    let depth = Math.max(0.22, (maxY - minY + 1) * CELL_M * 0.88);
    if (def.id === 'W-RG') depth = Math.max(depth, 2.9);
    if (def.id === 'W-BR') depth = Math.max(depth, 1.65);

    return {
      instanceId: placed.instanceId,
      partId: placed.partId,
      name: def.name,
      category: def.category,
      massT: (def.massKg * effectiveMults(placed, STATIC_CTX).massKg) / 1000,
      localPositionM: [
        (centerX - (chassis.width - 1) / 2) * CELL_M,
        bodyHeight / 2 + height / 2 + 0.07,
        ((chassis.height - 1) / 2 - centerY) * CELL_M,
      ],
      localSizeM: [width, height, depth],
      recoilKnS: def.weapon?.recoilKnS,
    };
  });
}

export function computePhysicalCenterOfMass(
  structuralMassT: number,
  parts: PhysicalPart[],
): Vec3Tuple {
  const totalMass = structuralMassT + parts.reduce((sum, part) => sum + part.massT, 0);
  if (totalMass <= 0) return [0, 0, 0];
  const moment = parts.reduce<Vec3Tuple>(
    (acc, part) => [
      acc[0] + part.localPositionM[0] * part.massT,
      acc[1] + part.localPositionM[1] * part.massT,
      acc[2] + part.localPositionM[2] * part.massT,
    ],
    [0, 0, 0],
  );
  return [moment[0] / totalMass, moment[1] / totalMass, moment[2] / totalMass];
}

export function buildPhysicalMech(
  build: Build,
  options: {
    id?: string;
    name?: string;
    gait?: GaitKind;
    stressParts?: PhysicalPart[];
  } = {},
): PhysicalMechDescription {
  const chassis = getChassis(build.chassisId);
  const gait = options.gait ?? (chassis.type.toLowerCase().includes('quad') ? 'quad' : 'biped');
  const bodySizeM: Vec3Tuple = [
    Math.max(1.15, chassis.width * CELL_M * 0.76),
    gait === 'biped' ? 0.72 : 0.62,
    Math.max(1.05, chassis.height * CELL_M * 0.68),
  ];
  const structuralMassT = chassis.ratedMassT * 0.3;
  const parts = [...buildParts(build, bodySizeM[1]), ...(options.stressParts ?? [])];
  const payloadMassT = parts.reduce((sum, part) => sum + part.massT, 0);
  const totalMassT = structuralMassT + payloadMassT;
  const speed = computeSpeedProfile(chassis, build);
  return {
    id: options.id ?? build.chassisId,
    name: options.name ?? chassis.name,
    chassisId: chassis.id,
    structuralMassT,
    totalMassT,
    payloadMassT,
    ratedMassT: chassis.ratedMassT,
    loadRatio: totalMassT / chassis.ratedMassT,
    bodySizeM,
    centerOfMassLocalM: computePhysicalCenterOfMass(structuralMassT, parts),
    parts,
    legRig: makeLegRig(gait, bodySizeM),
    locomotion: {
      // A visual gait has a stride-frequency ceiling that is intentionally
      // below the combat abstraction's top speed. This keeps planted feet
      // credible while payload mass still reduces the acceleration naturally.
      maxSpeedMps: Math.min(speed.fwd, gait === 'biped' ? 1.8 : 2.2),
      accelMps2: chassis.accelMps2,
      turnRateDegS: chassis.turnRateDegS,
    },
  };
}

function template(id: string) {
  const found = TEMPLATES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing prototype template ${id}`);
  return found;
}

const vulture = template('vulture-skirmisher');
const mule = template('mule-gunline');
const railgunMule = template('railgun-mule');
const bastion = template('bastion-tank');

export const VULTURE_LONGSHOT: PhysicalPart = {
  instanceId: 'stress-longshot',
  partId: 'W-RG',
  name: 'Longshot (illegal stress mount)',
  category: 'weapon',
  massT: 1.4,
  localPositionM: [0, 1.0, -0.84],
  localSizeM: [0.72, 0.46, 4.4],
  recoilKnS: 8,
  stressOnly: true,
};

export const PROTOTYPE_LOADOUTS: PrototypeLoadout[] = [
  {
    id: 'vulture-longshot',
    name: 'Vulture + Longshot',
    blurb: 'Illegal stress rig · 1.4 t railgun on a 3 t scout',
    build: vulture.build,
    gait: 'biped',
    stressParts: [VULTURE_LONGSHOT],
    featured: true,
  },
  {
    id: vulture.id,
    name: vulture.name,
    blurb: 'Legal scout baseline · carbine and machine gun',
    build: vulture.build,
    gait: 'biped',
  },
  {
    id: mule.id,
    name: mule.name,
    blurb: 'Legal quad baseline · compact autocannon',
    build: mule.build,
    gait: 'quad',
  },
  {
    id: railgunMule.id,
    name: railgunMule.name,
    blurb: 'Legal heavy payload · four planted feet',
    build: railgunMule.build,
    gait: 'quad',
  },
  {
    id: bastion.id,
    name: bastion.name,
    blurb: 'Legal assault biped · slow and hard to upset',
    build: bastion.build,
    gait: 'biped',
  },
];

export function describeLoadout(loadout: PrototypeLoadout): PhysicalMechDescription {
  return buildPhysicalMech(loadout.build, {
    id: loadout.id,
    name: loadout.name,
    gait: loadout.gait,
    stressParts: loadout.stressParts,
  });
}
