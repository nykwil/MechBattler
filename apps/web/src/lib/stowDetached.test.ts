import { describe, expect, it } from 'vitest';
import { stowPayloadFromDetached } from './stowDetached.js';

const base = {
  detached: { instanceId: 'p1' },
  selectedPartId: 'W-MG',
  placeExtras: { integrity: 0.8, modifiers: ['leaky'] as string[] | undefined, variant: undefined },
  provenance: { source: 'starter' as const },
  runActive: true,
  benchUsed: 0,
  benchCap: 8,
};

describe('stowPayloadFromDetached', () => {
  it('parks an owned detached part on the bench during a live run', () => {
    expect(stowPayloadFromDetached(base)).toEqual({
      id: 'p1',
      partId: 'W-MG',
      integrity: 0.8,
      modifiers: ['leaky'],
      variant: undefined,
      provenance: { source: 'starter' },
    });
  });

  it('refuses when there is nothing detached or the run is not live', () => {
    expect(stowPayloadFromDetached({ ...base, detached: null })).toBeNull();
    expect(stowPayloadFromDetached({ ...base, runActive: false })).toBeNull();
    expect(stowPayloadFromDetached({ ...base, selectedPartId: null })).toBeNull();
  });

  it('refuses when the bench is full — that is the only mid-run discard path', () => {
    expect(stowPayloadFromDetached({ ...base, benchUsed: 8 })).toBeNull();
  });
});
