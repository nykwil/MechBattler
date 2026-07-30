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

/**
 * docs/14 §7 -- detach is one state, not two. The part comes off the plate and
 * you are holding it, so a detach-and-replace must be a move rather than a copy.
 */
describe('useBuild detach', () => {
  function placeAt(result: { current: ReturnType<typeof useBuild> }, partId: string, x: number, y: number) {
    act(() => result.current.selectPart(partId));
    act(() => result.current.aim(x, y));
    act(() => result.current.place());
  }

  it('lifts the part off the plate and arms it', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    placeAt(result, 'U-CON', 2, 3);
    const instanceId = result.current.state.parts[0].instanceId;

    act(() => result.current.detach(instanceId));

    expect(result.current.state.parts).toHaveLength(0);
    expect(result.current.state.selectedPartId).toBe('U-CON');
    expect(result.current.state.ghost).toEqual({ x: 2, y: 3 });
    expect(result.current.state.detached?.instanceId).toBe(instanceId);
  });

  it('re-places as a move, consuming no new instance', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    placeAt(result, 'U-CON', 2, 3);
    const instanceId = result.current.state.parts[0].instanceId;
    const seqBefore = result.current.state.nextSeq;

    act(() => result.current.detach(instanceId));
    act(() => result.current.aim(1, 1));
    act(() => result.current.place());

    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.state.parts[0].instanceId).toBe(instanceId);
    expect(result.current.state.parts[0].origin).toEqual({ x: 1, y: 1 });
    expect(result.current.state.nextSeq).toBe(seqBefore);
    expect(result.current.state.detached).toBeNull();
  });

  it('carries integrity and modifiers across the round trip', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    placeAt(result, 'U-CON', 2, 3);
    const instanceId = result.current.state.parts[0].instanceId;
    act(() => result.current.setIntegrity(instanceId, 0.5));

    act(() => result.current.detach(instanceId));
    act(() => result.current.place());

    expect(result.current.state.parts[0].integrity).toBe(0.5);
  });

  it('discarding a detached part leaves the plate without it', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    placeAt(result, 'U-CON', 2, 3);
    const instanceId = result.current.state.parts[0].instanceId;

    act(() => result.current.detach(instanceId));
    act(() => result.current.selectPart(null)); // Discard / Esc

    expect(result.current.state.parts).toHaveLength(0);
    expect(result.current.state.detached).toBeNull();
    expect(result.current.state.powerPriority).not.toContain(instanceId);
  });

  it('restores brownout rank rather than demoting a moved part', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    // Two power-drawing parts, so there is a rank order to disturb.
    placeAt(result, 'W-AC', 1, 1);
    placeAt(result, 'W-CB', 3, 1);
    const first = result.current.state.parts[0].instanceId;
    const rankBefore = result.current.state.powerPriority.indexOf(first);
    expect(rankBefore).toBeGreaterThanOrEqual(0);

    act(() => result.current.detach(first));
    // Back to where it was: guaranteed legal, since detaching freed those cells.
    act(() => result.current.aim(1, 1));
    act(() => result.current.place());

    // A move must not silently change what browns out first.
    expect(result.current.state.powerPriority.indexOf(first)).toBe(rankBefore);
  });
});

/**
 * The armed ghost must always be somewhere the plate can draw it. The plate only
 * renders cells that exist on the chassis mask, so a ghost parked off-mask is
 * invisible -- the player arms a part and sees nothing at all.
 */
describe('useBuild ghost visibility', () => {
  it('never parks a fresh ghost off the chassis mask', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;

    for (const partId of ['U-CON', 'U-RAD', 'W-LAS', 'R-C40']) {
      act(() => result.current.selectPart(null));
      act(() => result.current.selectPart(partId));
      const ghost = result.current.state.ghost;
      expect(ghost, partId).not.toBeNull();
      expect(chassis.mask[ghost!.y]?.[ghost!.x], `${partId} at ${ghost!.x},${ghost!.y}`).toBeTruthy();
    }
  });

  it('still shows a ghost on a mask cell when nothing legal is left', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;

    // Fill every cell, so no origin can be legal.
    act(() => {
      const parts = [];
      let n = 0;
      for (let y = 0; y < chassis.height; y += 1) {
        for (let x = 0; x < chassis.width; x += 1) {
          if (!chassis.mask[y]?.[x]) continue;
          if (x === chassis.coreCell.x && y === chassis.coreCell.y) continue;
          n += 1;
          parts.push({
            instanceId: `f${n}`, partId: 'U-CON',
            origin: { x, y }, rotation: 0 as const, integrity: 1,
          });
        }
      }
      result.current.loadBuild({ chassisId: 'CH-5', parts, powerPriority: [] });
    });

    act(() => result.current.selectPart('U-CON'));
    const ghost = result.current.state.ghost;

    expect(ghost).not.toBeNull();
    expect(chassis.mask[ghost!.y]?.[ghost!.x]).toBeTruthy();
    // And it is honest about being unplaceable rather than hiding.
    expect(result.current.checkCandidate(ghost!.x, ghost!.y)).not.toBeNull();
  });
});

/**
 * Aiming centres the ghost on the tapped cell, clamped to the chassis. This is the
 * prototype's behaviour and it exists for touch: a fingertip covers the cells it
 * is aiming at, so a part bigger than one cell must appear under the finger rather
 * than offset down and right by its own footprint.
 */
describe('useBuild aim centring', () => {
  it('leaves single-cell parts on the tapped cell', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(3, 3));
    expect(result.current.state.ghost).toEqual({ x: 3, y: 3 });
  });

  it('centres a multi-cell part on the tapped cell', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    // Lump is 2x2, so its origin sits one cell up and left of the tap.
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(3, 3));
    expect(result.current.state.ghost).toEqual({ x: 2, y: 2 });
  });

  it('clamps against the near edge rather than going negative', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(0, 0));
    expect(result.current.state.ghost).toEqual({ x: 0, y: 0 });
  });

  it('clamps against the far edge so the footprint stays on the chassis', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(chassis.width - 1, chassis.height - 1));

    const ghost = result.current.state.ghost!;
    expect(ghost.x).toBe(chassis.width - 2);
    expect(ghost.y).toBe(chassis.height - 2);
  });

  it('accounts for rotation when centring', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    // Gill is a 3x1 line; rotated it is 1x3, so the centring offset swaps axes.
    act(() => result.current.selectPart('U-RAD'));
    act(() => result.current.aim(3, 3));
    const flat = result.current.state.ghost!;

    act(() => result.current.rotate());
    act(() => result.current.aim(3, 3));
    const upright = result.current.state.ghost!;

    expect(flat).toEqual({ x: 2, y: 3 });
    expect(upright).toEqual({ x: 3, y: 2 });
  });
});
