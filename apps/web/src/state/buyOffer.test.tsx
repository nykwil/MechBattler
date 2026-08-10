import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BENCH_CAP, useRun } from './runState.js';

/**
 * Buying a scrapyard offer is one transaction.
 *
 * It used to be two: the component charged scrap, then called `addBench` -- which
 * silently no-ops on a full bench. The pair could therefore take the money and
 * deliver nothing, and the only thing preventing it was a guard in a different
 * module from the state it protected. These pin that neither half can happen alone.
 */
const offer = (partId = 'W-MG', price = 5, integrity = 0.8) => ({ partId, price, integrity });

function liveRun() {
  const hook = renderHook(() => useRun());
  act(() => hook.result.current.start('Test kit'));
  return hook;
}

/** The active run's data, or a failure that says so rather than a type error. */
function data(result: { current: ReturnType<typeof useRun> }) {
  const { run } = result.current;
  if (run.phase !== 'active') throw new Error(`expected an active run, got ${run.phase}`);
  return run.data;
}

describe('buyOffer', () => {
  beforeEach(() => localStorage.clear());

  it('charges the price and benches the part', () => {
    const { result } = liveRun();
    const before = data(result).scrap;

    act(() => result.current.buyOffer(offer('W-MG', 5, 0.8)));

    expect(data(result).scrap).toBe(before - 5);
    expect(data(result).benchPool).toHaveLength(1);
    expect(data(result).benchPool[0]!.partId).toBe('W-MG');
    expect(data(result).benchPool[0]!.integrity).toBe(0.8);
  });

  it('records where the part came from', () => {
    const { result } = liveRun();
    act(() => result.current.buyOffer(offer()));

    const part = data(result).benchPool[0]!;
    expect(part.provenance).toEqual({ source: 'scrapyard', nodeIndex: data(result).nodeIndex });
    expect(data(result).partProvenance[part.id]).toEqual(part.provenance);
  });

  it('does nothing at all when the price exceeds the purse', () => {
    const { result } = liveRun();
    const before = data(result).scrap;

    act(() => result.current.buyOffer(offer('W-RG', before + 1)));

    expect(data(result).scrap).toBe(before);
    expect(data(result).benchPool).toEqual([]);
  });

  it('does nothing at all when the bench is full', () => {
    // The case that could previously charge and deliver nothing.
    const { result } = liveRun();
    act(() => {
      for (let i = 0; i < BENCH_CAP; i++) {
        result.current.addBench({ id: `filler-${i}`, partId: 'W-MG', integrity: 1 });
      }
    });
    expect(data(result).benchPool).toHaveLength(BENCH_CAP);
    const before = data(result).scrap;

    act(() => result.current.buyOffer(offer('W-MG', 1)));

    expect(data(result).scrap, 'a refused purchase must not charge').toBe(before);
    expect(data(result).benchPool).toHaveLength(BENCH_CAP);
  });

  it('mints a distinct id per purchase, so two buys are two bench parts', () => {
    const { result } = liveRun();
    act(() => result.current.buyOffer(offer('W-MG', 1)));
    act(() => result.current.buyOffer(offer('W-MG', 1)));

    const ids = data(result).benchPool.map((part) => part.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, `ids collided: ${ids.join(', ')}`).toBe(2);
  });

  it('is inert outside an active run', () => {
    const { result } = renderHook(() => useRun());
    expect(result.current.run.phase).toBe('none');
    act(() => result.current.buyOffer(offer()));
    expect(result.current.run.phase).toBe('none');
  });
});
