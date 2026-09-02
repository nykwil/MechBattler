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

  it('says an empty run part list is empty, and where parts come from', () => {
    // A run starts with everything on the mech and nothing in the list, so this
    // empty state is the *normal* one for the first fight -- it has to read as
    // "not yet" rather than as a screen that failed to load.
    palette({ instances: [], category: 'reactor', label: 'Run parts' });

    expect(screen.getByText(/nothing of this kind in your parts/i)).toBeTruthy();
    expect(screen.getByText(/salvage.*detach/i)).toBeTruthy();
  });

  it('lists one row per owned instance, not one per part type', () => {
    // Two Judges off two wrecks are two different objects: different damage,
    // different mods. Collapsing them to "Judge x2" loses the only information
    // that makes salvage worth looking at.
    palette({
      category: 'weapon',
      instances: [
        { id: 'a', partId: 'W-AC', integrity: 0.62, modifiers: ['cold-bore'] },
        { id: 'b', partId: 'W-AC', integrity: 1 },
      ],
    });

    expect(screen.getAllByRole('button', { name: /Judge/ })).toHaveLength(2);
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByText(/Cold bore/)).toBeTruthy();
  });

  it('arms the exact instance that was tapped', () => {
    const onSelectInstance = vi.fn();
    palette({
      category: 'weapon',
      onSelectInstance,
      instances: [
        { id: 'a', partId: 'W-AC', integrity: 0.62 },
        { id: 'b', partId: 'W-AC', integrity: 1 },
      ],
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Judge/ })[1]!);
    expect(onSelectInstance).toHaveBeenCalledWith('b');
  });

  it('does not list installed parts — the mech is where those are', () => {
    palette({ category: 'weapon', instances: [{ id: 'a', partId: 'W-MG', integrity: 1 }] });

    expect(screen.getByText(/Stitcher/)).toBeTruthy();
    expect(screen.queryByText(/Judge/)).toBeNull();
  });
});
