import { cleanup, render, screen } from '@testing-library/react';
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
    palette({ visiblePartIds: new Set(), category: 'reactor', readOnly: true });

    expect(screen.getByText(/on the mech or the bench/i)).toBeTruthy();
  });
});
