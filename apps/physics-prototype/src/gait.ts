import type { GaitKind, Vec3Tuple } from './model.js';

export interface FootState {
  planted: Vec3Tuple;
  from: Vec3Tuple;
  to: Vec3Tuple;
  progress: number;
  swinging: boolean;
}

export interface GaitState {
  activeGroup: number;
  feet: FootState[];
}

export function createGaitState(feet: Vec3Tuple[]): GaitState {
  return {
    activeGroup: 0,
    feet: feet.map((foot) => ({
      planted: [...foot],
      from: [...foot],
      to: [...foot],
      progress: 1,
      swinging: false,
    })),
  };
}

export function nextStepGroup(gait: GaitKind, activeGroup: number): number[] {
  if (gait === 'biped') return activeGroup % 2 === 0 ? [0] : [1];
  return activeGroup % 2 === 0 ? [0, 3] : [1, 2];
}

export function stepArc(
  from: Vec3Tuple,
  to: Vec3Tuple,
  progress: number,
  height: number,
): Vec3Tuple {
  const t = Math.max(0, Math.min(1, progress));
  const lift = Math.sin(Math.PI * t) * height;
  const smooth = t * t * (3 - 2 * t);
  return [
    from[0] + (to[0] - from[0]) * smooth,
    from[1] + (to[1] - from[1]) * smooth + lift,
    from[2] + (to[2] - from[2]) * smooth,
  ];
}

export function supportCentroid(feet: Vec3Tuple[], excluded: number[] = []): Vec3Tuple {
  const planted = feet.filter((_, index) => !excluded.includes(index));
  if (planted.length === 0) return [0, 0, 0];
  const sum = planted.reduce<Vec3Tuple>(
    (acc, foot) => [acc[0] + foot[0], acc[1] + foot[1], acc[2] + foot[2]],
    [0, 0, 0],
  );
  return [sum[0] / planted.length, sum[1] / planted.length, sum[2] / planted.length];
}

export function horizontalDistance(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
