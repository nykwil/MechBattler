import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBuild } from './useBuild.js';

/**
 * docs/14 §6 -- arming a part does not place it. These cover the state model
 * that touch, keyboard, and assistive tech all share: arm, aim, commit.
 */
describe('useBuild ghost placement', () => {
  it('arms a part with a ghost on a legal cell, placing nothing', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));

    expect(result.current.state.ghost).not.toBeNull();
    expect(result.current.state.parts).toHaveLength(0);
    const { x, y } = result.current.state.ghost!;
    expect(result.current.checkCandidate(x, y)).toBeNull();
  });

  it('clears the ghost when disarmed', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.selectPart(null));

    expect(result.current.state.ghost).toBeNull();
  });

  it('commits at the ghost, not at the cell that armed it', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(2, 3));
    act(() => result.current.place());

    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.state.parts[0].origin).toEqual({ x: 2, y: 3 });
  });

  it('nudges the ghost and clamps it inside the chassis', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(0, 0));
    act(() => result.current.nudge(-1, -1));

    // A keyboard has no cell to tap, so arrows are its aim -- but they must not
    // walk the ghost off the plate.
    expect(result.current.state.ghost).toEqual({ x: 0, y: 0 });

    act(() => result.current.nudge(1, 0));
    expect(result.current.state.ghost).toEqual({ x: 1, y: 0 });
  });

  it('refuses to commit an illegal ghost', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(2, 3));
    act(() => result.current.place());
    // Same cell twice: the second commit overlaps the first.
    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(2, 3));
    act(() => result.current.place());

    expect(result.current.state.parts).toHaveLength(1);
  });

  it('holds the ghost origin through a rotation', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(2, 2));
    act(() => result.current.rotate());

    // Rotate must read as turning in place, not as moving the part.
    expect(result.current.state.ghost).toEqual({ x: 2, y: 2 });
    expect(result.current.state.rotation).toBe(90);
  });
});
