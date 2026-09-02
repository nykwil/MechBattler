import { describe, expect, it } from 'vitest';
import { planDetach } from './planDetach.js';

const placed = {
  instanceId: 'W-CB-3',
  partId: 'W-CB',
  origin: { x: 1, y: 1 },
  rotation: 0 as const,
  integrity: 0.62,
  modifiers: ['cold-bore'],
  variant: undefined,
};

const base = {
  placed,
  provenance: { source: 'salvage' as const, nodeIndex: 2 },
  runActive: true,
  listUsed: 3,
  listCap: 8,
};

describe('planDetach', () => {
  it('moves the exact instance into the run part list, at the end of it', () => {
    expect(planDetach(base)).toEqual({
      kind: 'move',
      index: 3,
      entry: {
        id: 'W-CB-3',
        partId: 'W-CB',
        integrity: 0.62,
        modifiers: ['cold-bore'],
        variant: undefined,
        provenance: { source: 'salvage', nodeIndex: 2 },
      },
    });
  });

  it('refuses rather than destroying the part when the list is full', () => {
    expect(planDetach({ ...base, listUsed: 8 })).toEqual({ kind: 'refused', reason: 'list-full' });
  });

  it('detaches without a list outside a run — the garage has infinite copies', () => {
    expect(planDetach({ ...base, runActive: false })).toEqual({ kind: 'free' });
  });
});
