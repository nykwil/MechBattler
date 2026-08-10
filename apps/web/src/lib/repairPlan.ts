import { getPart } from '@mechbattler/sim';
import { repairCost } from '../state/runState.js';

/**
 * What a "repair all" would cost and touch. A description rather than an action, so
 * the price shown on the button and the price actually charged come from one place.
 *
 * They did not. The run panel summed the bill to render `repair all −{n}` and to
 * disable the button; App re-derived the identical sum to decide whether to charge.
 * The two agreed only because both happened to reduce the same array with the same
 * function, which is not something either file could see -- a quoted price and a
 * charged price with nothing holding them together.
 *
 * Chassis integrity is deliberately absent: neither caller included it, and the body
 * has its own repair control priced by `chassisRepairCost`.
 */
export interface RepairAllPlan {
  installedCost: number;
  benchCost: number;
  totalCost: number;
  /** Repair-all is all-or-nothing: partial repairs are the per-part controls' job. */
  affordable: boolean;
  /** Installed parts to restore to integrity 1. */
  instanceIds: string[];
  /** Bench slots to repair, as indices into the bench pool. */
  benchIndices: number[];
}

interface DamageableInstalled { instanceId: string; partId: string; integrity: number }
interface DamageableBench { partId: string; integrity: number }

const costToFull = (part: DamageableBench): number =>
  repairCost(getPart(part.partId).tier, part.integrity, 1);

export function planRepairAll(args: {
  parts: readonly DamageableInstalled[];
  benchPool: readonly DamageableBench[];
  scrap: number;
}): RepairAllPlan {
  const damagedInstalled = args.parts.filter((part) => part.integrity < 1);
  const damagedBench = args.benchPool
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.integrity < 1);

  const installedCost = damagedInstalled.reduce((total, part) => total + costToFull(part), 0);
  const benchCost = damagedBench.reduce((total, { part }) => total + costToFull(part), 0);
  const totalCost = installedCost + benchCost;

  return {
    installedCost,
    benchCost,
    totalCost,
    affordable: totalCost <= args.scrap,
    instanceIds: damagedInstalled.map((part) => part.instanceId),
    benchIndices: damagedBench.map(({ index }) => index),
  };
}
