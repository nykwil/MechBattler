import { describe, expect, it } from 'vitest';
import { PARTS, TEMPLATES, getPart, type Build } from '@mechbattler/sim';
import { canLaunch, hasReactor, hasWeapon, launchBlockers } from './launchGate.js';
import { START_BUDGET } from '../state/runState.js';

/**
 * A real starting blueprint, not hand-written coordinates. A fixture in this repo
 * once put `x`/`y` at the top level instead of inside `origin`, so every consumer
 * read it as unplaced and the test passed while asserting nothing.
 */
const starter = (): Build => {
  const template = TEMPLATES.find((t) => t.build.chassisId === 'CH-5');
  if (!template) throw new Error('no CH-5 template to build a fixture from');
  return structuredClone(template.build);
};

/** The same build with every part of one category dropped. */
const without = (category: string): Build => {
  const build = starter();
  return { ...build, parts: build.parts.filter((p) => getPart(p.partId).category !== category) };
};

describe('the launch gate', () => {
  it('passes a shipped starting blueprint', () => {
    // If this fails, the templates themselves cannot start a run.
    expect(launchBlockers(starter())).toEqual([]);
    expect(canLaunch(starter())).toBe(true);
  });

  it('names the missing reactor', () => {
    const build = without('reactor');
    expect(hasReactor(build)).toBe(false);
    expect(hasWeapon(build)).toBe(true);
    expect(launchBlockers(build)).toEqual(['no-reactor']);
  });

  it('names the missing weapon', () => {
    const build = without('weapon');
    expect(hasWeapon(build)).toBe(false);
    expect(launchBlockers(build)).toEqual(['no-weapon']);
  });

  it('blocks a build over the starting tier budget', () => {
    // Six tier-3 railguns is far past any plausible budget.
    const heavy: Build = {
      ...starter(),
      parts: Array.from({ length: 6 }, (_, i) => ({
        instanceId: `w${i}`, partId: 'W-RG', origin: { x: i % 3, y: Math.floor(i / 3) },
        rotation: 0 as const, integrity: 1,
      })),
    };
    expect(launchBlockers(heavy)).toContain('over-tier-budget');
    expect(canLaunch(heavy)).toBe(false);
    expect(START_BUDGET).toBeGreaterThan(0);
  });

  it('reports the budget first, so one message shows the worst problem', () => {
    // The run panel renders only blockers[0]; over-budget outranks a bare frame.
    // Armour is tier 1, so it takes START_BUDGET + 1 of it to break the budget
    // without contributing a gun or a reactor.
    const overAndEmpty: Build = {
      chassisId: 'CH-5', powerPriority: [],
      parts: Array.from({ length: START_BUDGET + 1 }, (_, i) => ({
        instanceId: `a${i}`, partId: 'U-ARM', origin: { x: i % 3, y: Math.floor(i / 3) },
        rotation: 0 as const, integrity: 1,
      })),
    };
    expect(launchBlockers(overAndEmpty)[0]).toBe('over-tier-budget');
    expect(launchBlockers(overAndEmpty)).toEqual(
      ['over-tier-budget', 'no-reactor', 'no-weapon'],
    );
  });

  it('gives free play the two predicates without the budget', () => {
    // The arena and test bench check gear, not the run's starting allowance.
    const heavy: Build = {
      chassisId: 'CH-5', powerPriority: [],
      parts: [
        ...Array.from({ length: 6 }, (_, i) => ({
          instanceId: `w${i}`, partId: 'W-RG', origin: { x: i % 3, y: Math.floor(i / 3) },
          rotation: 0 as const, integrity: 1,
        })),
        { instanceId: 'r', partId: 'R-E25', origin: { x: 0, y: 2 }, rotation: 0 as const, integrity: 1 },
      ],
    };
    expect(hasWeapon(heavy)).toBe(true);
    expect(hasReactor(heavy)).toBe(true);
    expect(canLaunch(heavy)).toBe(false);
  });

  it('reads the catalog category, not the id prefix or the payload', () => {
    // Five call sites used to answer this with two different conventions: four
    // tested startsWith('W-') / startsWith('R-'), the fifth (the intel sheet)
    // tested a truthy `.weapon` / `.reactor` payload. Both agree with `category`
    // on the whole catalog today; this pins that the gate follows `category` if a
    // future part ever breaks either convention.
    for (const [id, def] of Object.entries(PARTS)) {
      if (def.category === 'weapon') {
        expect(id.startsWith('W-'), id).toBe(true);
        expect(!!def.weapon, id).toBe(true);
      } else {
        expect(!!def.weapon, id).toBe(false);
      }
      if (def.category === 'reactor') {
        expect(id.startsWith('R-'), id).toBe(true);
        expect(!!def.reactor, id).toBe(true);
      } else {
        expect(!!def.reactor, id).toBe(false);
      }
    }
    const build = without('weapon');
    expect(build.parts.some((p) => p.partId.startsWith('W-'))).toBe(false);
    expect(hasWeapon(build)).toBe(false);
  });
});
