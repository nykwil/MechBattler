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

/** The row button for a part, found via the name the player reads. */
const row = (name: RegExp) => screen.getByText(name).closest('button') as HTMLButtonElement | null;

describe('game-facing equipment inventory', () => {
  it('shows equipment the context does not allow, disabled rather than hidden', () => {
    // Filtering these out left the reactor tab holding a single row and read as a
    // broken screen. They are the list of what there is to win, so they stay on it.
    palette({ visiblePartIds: new Set(['W-MG']) });

    expect(row(/Stitcher/)?.disabled).toBe(false);
    const locked = row(/Judge/);
    expect(locked).toBeTruthy();
    expect(locked?.disabled).toBe(true);
  });

  it('names why a part cannot be fitted, in words and not by dimming alone', () => {
    palette({ visiblePartIds: new Set(['W-MG']), lockedReason: 'Not owned' });

    expect(screen.getAllByText('Not owned').length).toBeGreaterThan(0);
    expect(row(/Judge/)?.title).toBe('Not owned');
    expect(row(/Stitcher/)?.textContent).not.toContain('Not owned');
  });

  it('leaves every part fittable when the context sets no limit', () => {
    palette();

    expect(row(/Judge/)?.disabled).toBe(false);
    expect(screen.queryByText('Locked')).toBeNull();
  });

  it('disables everything during an active run, catalog included', () => {
    palette({ visiblePartIds: new Set(['W-MG']), readOnly: true });

    expect(row(/Stitcher/)?.disabled).toBe(true);
    expect(row(/Judge/)?.disabled).toBe(true);
  });
});
