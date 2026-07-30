import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BP_MD, useDocked } from './useDocked.js';

function stubMatchMedia(matches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    media: '',
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
    removeEventListener: () => {},
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return { mql, listeners };
}

afterEach(() => vi.unstubAllGlobals());

describe('useDocked', () => {
  it('mirrors the --bp-md value used in the stylesheets', () => {
    // @media cannot read custom properties, so the number is repeated in CSS and
    // here. If they drift, sheets dock at a different width than the grid changes.
    expect(BP_MD).toBe(768);
  });

  it('is false below the breakpoint', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useDocked());
    expect(result.current).toBe(false);
  });

  it('is true at or above the breakpoint', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useDocked());
    expect(result.current).toBe(true);
  });

  it('queries the breakpoint it claims to', () => {
    stubMatchMedia(true);
    renderHook(() => useDocked());
    expect(matchMedia).toHaveBeenCalledWith(`(min-width: ${BP_MD}px)`);
  });
});
