import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartPalette } from './PartPalette.js';

afterEach(cleanup);

const palette = (props: Partial<Parameters<typeof PartPalette>[0]> = {}) => render(
  <PartPalette
    selectedPartId={null}
    onSelect={vi.fn()}
    onHover={vi.fn()}
    label="Available equipment"
    {...props}
  />,
);

describe('game-facing equipment inventory', () => {
  it('renders only the equipment ids made available by the owning context', () => {
    // The inventory lists what you have, not what exists.
    palette({ visiblePartIds: new Set(['W-MG']) });

    expect(screen.getByText(/Stitcher/)).toBeTruthy();
    expect(screen.queryByText(/Judge/)).toBeNull();
  });

  it('lists everything when the context sets no limit', () => {
    palette();

    expect(screen.getByText(/Judge/)).toBeTruthy();
    expect(screen.getByText(/Stitcher/)).toBeTruthy();
  });

  it('says an empty category is empty rather than rendering nothing', () => {
    // A blank panel reads as a broken screen; owning none of a kind is ordinary.
    palette({ visiblePartIds: new Set(), category: 'reactor' });

    expect(screen.getByText(/no equipment of this kind yet/i)).toBeTruthy();
  });

  it('names the bench as the source when a run is under way', () => {
    palette({
      visiblePartIds: new Set(),
      category: 'reactor',
      ownedCounts: new Map(),
      fittablePartIds: new Set(),
      readOnly: true,
    });

    expect(screen.getByText(/on the mech or the bench/i)).toBeTruthy();
  });

  it('lets a benched spare be armed while installed-only rows stay locked', () => {
    const onSelect = vi.fn();
    palette({
      visiblePartIds: new Set(['W-MG', 'W-AC']),
      ownedCounts: new Map([['W-MG', 1], ['W-AC', 1]]),
      fittablePartIds: new Set(['W-MG']),
      onSelect,
      category: 'weapon',
      label: 'Run inventory',
    });

    const stitcher = screen.getByRole('button', { name: /Stitcher/ });
    const judge = screen.getByRole('button', { name: /Judge/ });
    expect(stitcher.hasAttribute('disabled')).toBe(false);
    expect(judge.hasAttribute('disabled')).toBe(true);
    fireEvent.click(stitcher);
    expect(onSelect).toHaveBeenCalledWith('W-MG');
    expect(screen.getByText(/Tap a spare marked bench/i)).toBeTruthy();
  });
});
