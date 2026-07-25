import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartPalette } from './PartPalette.js';

afterEach(cleanup);

describe('game-facing equipment inventory', () => {
  it('renders only the equipment ids made available by the owning context', () => {
    render(
      <PartPalette
        selectedPartId={null}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        visiblePartIds={new Set(['W-MG'])}
        label="Available equipment"
      />,
    );
    expect(screen.getByText(/Stitcher/)).toBeTruthy();
    expect(screen.queryByText(/Judge/)).toBeNull();
    expect(screen.queryByText(/🔒/)).toBeNull();
  });
});
