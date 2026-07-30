import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Build } from '@mechbattler/sim';
import { IntelSheet } from './IntelSheet.js';
import { OPPONENTS } from '../lib/opponents.js';

const empty: Build = { chassisId: 'CH-5', parts: [], powerPriority: [] };
const armed: Build = {
  chassisId: 'CH-5',
  parts: [
    { instanceId: 'r', partId: 'R-C40', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'w', partId: 'W-AC', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
  ],
  powerPriority: [],
};

function renderSheet(build: Build, over: Partial<Parameters<typeof IntelSheet>[0]> = {}) {
  const picked: string[] = [];
  const fought: string[] = [];
  const { container } = render(
    <IntelSheet
      open
      onClose={() => {}}
      build={build}
      selectedId={null}
      onSelect={(o) => picked.push(o.id)}
      onFight={(o) => fought.push(o.id)}
      {...over}
    />,
  );
  return { container, picked, fought };
}

describe('IntelSheet', () => {
  it('shows a card per opponent with its intel', () => {
    const { container } = renderSheet(armed);
    const cards = [...container.querySelectorAll('.foe')];

    expect(cards).toHaveLength(OPPONENTS.length);
    for (const card of cards) {
      expect(card.querySelector('.foe-name')?.textContent).toBeTruthy();
      expect(card.querySelector('.foe-intel')?.textContent).toContain('Confirmed');
      // Threat is three marks, the surplus dimmed rather than absent, so the
      // rating reads as "1 of 3" instead of just "1".
      expect(card.querySelector('.threat')?.textContent).toHaveLength(3);
      expect(card.querySelector('.threat')?.getAttribute('aria-label')).toMatch(/Threat \d of 3/);
    }
  });

  it('names the blocker when the build cannot fight', () => {
    // Derived from the build, never a copied constant.
    expect(renderSheet(empty).container.querySelector('.fault')?.textContent)
      .toContain('No reactor mounted');

    const noGun: Build = { ...empty, parts: [armed.parts[0]!] };
    expect(renderSheet(noGun).container.querySelector('.fault')?.textContent)
      .toContain('No weapons mounted');

    expect(renderSheet(armed).container.querySelector('.fault')).toBeNull();
  });

  it('reports a chosen opponent rather than acting on it', () => {
    const { container, picked, fought } = renderSheet(armed);
    fireEvent.click(container.querySelectorAll('.foe')[1]!);

    expect(picked).toEqual([OPPONENTS[1]!.id]);
    expect(fought).toEqual([]);
  });

  it('offers Fight only once an opponent is chosen and the build can fight', () => {
    expect(renderSheet(armed).container.querySelector('.btn-primary')).toBeNull();

    const chosen = renderSheet(armed, { selectedId: OPPONENTS[0]!.id });
    expect(chosen.container.querySelector('.btn-primary')?.textContent).toBe('Fight');

    // A build that cannot fight is not offered the button at all.
    const blocked = renderSheet(empty, { selectedId: OPPONENTS[0]!.id });
    expect(blocked.container.querySelector('.btn-primary')).toBeNull();
  });
});
