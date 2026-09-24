import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HEAT_RESTART_C } from '@mechbattler/sim';
import { ShutdownBanner } from './BattleHud.js';

describe('ShutdownBanner (MW spec §5)', () => {
  it('renders nothing while the reactor runs', () => {
    const { container } = render(<ShutdownBanner mechShutdown={false} reactorCoreC={90} />);
    expect(container.innerHTML).toBe('');
  });
  it('names the restart line from the sim and how far there is to cool', () => {
    render(<ShutdownBanner mechShutdown reactorCoreC={HEAT_RESTART_C + 14} />);
    expect(screen.getByRole('status').textContent).toContain(`${HEAT_RESTART_C}°`);
    expect(screen.getByRole('status').textContent).toContain('14°');
  });
});
