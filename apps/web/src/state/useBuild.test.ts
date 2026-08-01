import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PARTS } from '@mechbattler/sim';
import { useBuild } from './useBuild.js';

/**
 * docs/14 §6 -- arming a part does not place it. These cover the state model
 * that touch, keyboard, and assistive tech all share: arm, aim, commit.
 */
describe('useBuild ghost placement', () => {
  it('arms every standalone catalog part at a placeable origin and orientation on an empty Mule', () => {
    for (const partId of Object.keys(PARTS).filter((id) => id !== 'U-SHELL')) {
      const { result, unmount } = renderHook(() => useBuild('CH-5'));
      act(() => result.current.selectPart(partId));
      const ghost = result.current.state.ghost!;

      expect(result.current.checkCandidate(ghost.x, ghost.y), partId).toBeNull();
      act(() => result.current.place());
      expect(result.current.state.parts, partId).toHaveLength(1);
      unmount();
    }
  });

  it('places a Carapace only over a compatible payload footprint', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('W-MG'));
    act(() => result.current.place());
    const weapon = result.current.state.parts[0]!;

    act(() => result.current.selectPart('U-SHELL'));
    expect(result.current.state.ghost).toEqual(weapon.origin);
    act(() => result.current.place());

    expect(result.current.state.parts.map((part) => part.partId)).toEqual(['W-MG', 'U-SHELL']);
  });

  it('automatically rotates a part when its authored orientation cannot fit', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('W-RG'));

    expect(result.current.state.rotation).toBe(90);
    const ghost = result.current.state.ghost!;
    expect(result.current.checkCandidate(ghost.x, ghost.y)).toBeNull();
  });

  it('places ordinary multi-cell equipment wholly inside a visible region', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('U-RAD'));
    act(() => result.current.aim(3, 4));
    const ghost = result.current.state.ghost!;

    expect(ghost.regionId).toBe('body');
    expect(result.current.checkCandidate(ghost.x, ghost.y)).toBeNull();
    act(() => result.current.place());
    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.state.parts[0].origin.regionId).toBe('body');
  });

  it('snaps a centred tap to a legal shoulder origin before placing', () => {
    const { result } = renderHook(() => useBuild('CH-5'));

    act(() => result.current.selectPart('R-E25'));
    act(() => result.current.aim(1, 1));
    const ghost = result.current.state.ghost!;

    expect(ghost).toEqual({ regionId: 'left-shoulder', x: 1, y: 0 });
    expect(result.current.checkCandidate(ghost.x, ghost.y)).toBeNull();
    act(() => result.current.place());
    expect(result.current.state.parts).toHaveLength(1);
  });

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
    expect(result.current.state.parts[0].origin).toEqual({ regionId: 'body', x: 2, y: 3 });
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
    expect(result.current.state.ghost).toEqual({ regionId: 'left-shoulder', x: 1, y: 0 });
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
    expect(result.current.state.ghost).toEqual({ regionId: 'body', x: 1, y: 2 });
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
    expect(result.current.state.ghost).toEqual({ regionId: 'body', x: 2, y: 3 });
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
    expect(result.current.state.parts[0].origin).toEqual({ regionId: 'left-shoulder', x: 1, y: 1 });
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
    expect(result.current.state.ghost).toEqual({ regionId: 'body', x: 3, y: 3 });
  });

  it('centres a multi-cell part on the tapped cell', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    // Lump is 2x2, so its origin sits one cell up and left of the tap.
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(3, 3));
    // The geometrically centred origin would cover the immutable core, so the
    // aim snaps one cell right to the nearest legal body origin.
    expect(result.current.state.ghost).toEqual({ regionId: 'body', x: 3, y: 2 });
  });

  it('snaps an off-mask corner tap into the nearest shoulder', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(0, 0));
    expect(result.current.state.ghost).toEqual({ regionId: 'left-shoulder', x: 1, y: 0 });
  });

  it('clamps against the far edge so the footprint stays on the chassis', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(chassis.width - 1, chassis.height - 1));

    const ghost = result.current.state.ghost!;
    expect(ghost).toEqual({ regionId: 'body', x: chassis.width - 2, y: chassis.height - 3 });
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

    // The regional body perimeter begins on row 2. The nearest legal
    // horizontal radiator therefore hugs that exposed top edge.
    expect(flat).toEqual({ regionId: 'body', x: 3, y: 2 });
    expect(upright).toEqual({ regionId: 'body', x: 5, y: 2 });
  });
});

/**
 * The ghost's whole footprint stays on the chassis. Clamping the origin to
 * width - 1 instead of width - w let a multi-cell part be walked or rotated until
 * part of it hung off the plate — a state the prototype prevents outright.
 */
describe('useBuild footprint clamping', () => {
  it('stops nudging before a multi-cell part leaves the chassis', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;
    act(() => result.current.selectPart('R-C40')); // 2x2

    for (let i = 0; i < 20; i += 1) act(() => result.current.nudge(1, 1));

    const ghost = result.current.state.ghost!;
    expect(ghost.x).toBe(chassis.width - 2);
    expect(ghost.y).toBe(chassis.height - 2);
  });

  it('re-clamps after a rotation that swaps the footprint', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    const chassis = result.current.chassis;
    act(() => result.current.selectPart('U-RAD')); // 3x1 flat

    // Walk to the bottom-right, legal while flat: origin can reach height - 1.
    for (let i = 0; i < 20; i += 1) act(() => result.current.nudge(1, 1));
    const flat = result.current.state.ghost!;
    expect(flat.y).toBe(chassis.height - 1);

    // Rotated it is 1x3, so that same origin would hang two cells off the bottom.
    // Clamping only pulls a coordinate back in; x is already legal and stays put.
    const flatX = flat.x;
    act(() => result.current.rotate());
    const upright = result.current.state.ghost!;
    expect(upright.y).toBe(chassis.height - 3);
    expect(upright.x).toBe(flatX);
  });

  it('keeps a rotation harmless when the part still fits', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.selectPart('R-C40'));
    act(() => result.current.aim(4, 4));
    const before = result.current.state.ghost!;

    act(() => result.current.rotate());

    // Well inside the chassis, so Rotate turns in place and moves nothing.
    expect(result.current.state.ghost).toEqual(before);
  });
});

describe('useBuild persistent routing tool', () => {
  it('paints multiple wire cells, then layers coolant until Done', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.setRouteTool('wire'));
    act(() => result.current.placeRoute(0, 2));
    act(() => result.current.placeRoute(0, 3));
    expect(result.current.state.routeTool).toBe('wire');
    expect(result.current.state.routes).toHaveLength(2);

    act(() => result.current.setRouteTool('coolant'));
    act(() => result.current.placeRoute(0, 2));
    expect(result.current.state.routes.filter((route) => route.x === 0 && route.y === 2))
      .toHaveLength(2);
    act(() => result.current.setRouteTool(null));
    expect(result.current.state.routeTool).toBeNull();
  });

  it('paints port endpoints and toggles an existing route layer off', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.setRouteTool('wire'));
    act(() => result.current.placeRoute(2, 1)); // left shoulder port endpoint
    expect(result.current.state.routes).toEqual([
      { kind: 'wire', regionId: 'left-shoulder', x: 2, y: 1 },
    ]);
    act(() => result.current.placeRoute(0, 2));
    act(() => result.current.placeRoute(0, 2));
    expect(result.current.state.routes).toHaveLength(1);
  });

  it('stamps both routing layers out from beneath newly placed equipment', () => {
    const { result } = renderHook(() => useBuild('CH-5'));
    act(() => result.current.setRouteTool('wire'));
    act(() => result.current.placeRoute(0, 2));
    act(() => result.current.setRouteTool('coolant'));
    act(() => result.current.placeRoute(0, 2));
    expect(result.current.state.routes).toHaveLength(2);

    act(() => result.current.selectPart('U-CON'));
    act(() => result.current.aim(0, 2));
    act(() => result.current.place());

    expect(result.current.state.parts).toHaveLength(1);
    expect(result.current.state.routes).toEqual([]);
  });
});
