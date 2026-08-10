import { describe, expect, it } from 'vitest';
import { getPart } from '@mechbattler/sim';
import { planRepairAll } from './repairPlan.js';
import { repairCost } from '../state/runState.js';

const installed = (instanceId: string, partId: string, integrity: number) =>
  ({ instanceId, partId, integrity });
const benched = (partId: string, integrity: number) => ({ partId, integrity });

/** The bill for one part, from the same function the planner uses. */
const toFull = (partId: string, integrity: number) =>
  repairCost(getPart(partId).tier, integrity, 1);

describe('planRepairAll', () => {
  it('costs nothing and touches nothing when everything is field-ready', () => {
    const plan = planRepairAll({
      parts: [installed('a', 'W-AC', 1), installed('b', 'R-E25', 1)],
      benchPool: [benched('W-MG', 1)],
      scrap: 0,
    });
    expect(plan.totalCost).toBe(0);
    expect(plan.instanceIds).toEqual([]);
    expect(plan.benchIndices).toEqual([]);
    // Free is affordable even with an empty purse — the button just isn't rendered.
    expect(plan.affordable).toBe(true);
  });

  it('bills installed and benched parts separately and together', () => {
    const plan = planRepairAll({
      parts: [installed('a', 'W-AC', 0.5), installed('b', 'R-E25', 1)],
      benchPool: [benched('W-MG', 0.25), benched('U-ARM', 1)],
      scrap: 9999,
    });
    expect(plan.installedCost).toBe(toFull('W-AC', 0.5));
    expect(plan.benchCost).toBe(toFull('W-MG', 0.25));
    expect(plan.totalCost).toBe(plan.installedCost + plan.benchCost);
    expect(plan.instanceIds).toEqual(['a']);
    expect(plan.benchIndices).toEqual([0]);
  });

  it('reports bench slots by their index in the pool, not by position among the damaged', () => {
    // The caller feeds these straight to repairBench(index), so a compacted list
    // would repair the wrong parts.
    const plan = planRepairAll({
      parts: [],
      benchPool: [benched('W-MG', 1), benched('W-AC', 0.4), benched('U-ARM', 1), benched('R-E25', 0.9)],
      scrap: 9999,
    });
    expect(plan.benchIndices).toEqual([1, 3]);
  });

  it('affords a bill that exactly equals the purse', () => {
    // repairCost ceils, so the boundary is worth pinning rather than assuming.
    const cost = toFull('W-AC', 0.5);
    const plan = planRepairAll({
      parts: [installed('a', 'W-AC', 0.5)], benchPool: [], scrap: cost,
    });
    expect(plan.totalCost).toBe(cost);
    expect(plan.affordable).toBe(true);
  });

  it('refuses one scrap short, but still says what it would have repaired', () => {
    const cost = toFull('W-AC', 0.5);
    const plan = planRepairAll({
      parts: [installed('a', 'W-AC', 0.5)], benchPool: [], scrap: cost - 1,
    });
    expect(plan.affordable).toBe(false);
    expect(plan.totalCost).toBe(cost);
    expect(plan.instanceIds).toEqual(['a']);
  });

  it('prices the whole job, so the quote cannot undercut the charge', () => {
    // The defect this replaced: the run panel quoted a price the handler
    // re-derived. Both now read totalCost from one call.
    const args = {
      parts: [installed('a', 'W-AC', 0.5), installed('b', 'W-MG', 0.2)],
      benchPool: [benched('R-E25', 0.7)],
      scrap: 9999,
    };
    const quoted = planRepairAll(args).totalCost;
    const charged = planRepairAll(args).installedCost + planRepairAll(args).benchCost;
    expect(quoted).toBe(charged);
  });
});
