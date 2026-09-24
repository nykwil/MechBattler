import { describe, expect, it } from 'vitest';
import { expandGroupOrders, cycleGroupState, resetToAuto } from './groupOrders.js';

describe('group orders (MW spec §3)', () => {
  const groups = [['a', 'b'], ['c'], []];

  it('AUTO adds nothing, HOLD holds, FIRE forces', () => {
    expect(expandGroupOrders(groups, ['auto', 'auto', 'auto'], {})).toEqual({});
    expect(expandGroupOrders(groups, ['hold', 'fire', 'auto'], {})).toEqual({ a: 'hold', b: 'hold', c: 'force' });
  });

  it('a per-gun setting wins over its group', () => {
    expect(expandGroupOrders(groups, ['hold', 'auto', 'auto'], { b: 'force' })).toEqual({ a: 'hold', b: 'force' });
  });

  it('cycles AUTO → HOLD → FIRE → AUTO', () => {
    expect(cycleGroupState('auto')).toBe('hold');
    expect(cycleGroupState('hold')).toBe('fire');
    expect(cycleGroupState('fire')).toBe('auto');
  });

  it('returning to auto keeps the Alpha counter, or every later press would be ignored (Review Focus 1)', () => {
    const m = { alpha: 4, groups: ['fire', 'hold', 'auto'], overrideHeat: true };
    const reset = resetToAuto(m, { groups: ['auto', 'auto', 'auto'], overrideHeat: false });
    expect(reset.alpha).toBe(4);
    expect(reset.groups).toEqual(['auto', 'auto', 'auto']);
  });
});
