import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getChassis, type BattleEvent, type Build } from '@mechbattler/sim';
import { DamageGrid } from './DamageGrid.js';

const build: Build = {
  chassisId: 'CH-5',
  parts: [
    { instanceId: 'r1', partId: 'R-C40', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'w1', partId: 'W-AC', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
  ],
  powerPriority: [],
};

const destroyedAt = (tSec: number, instanceId: string): BattleEvent =>
  ({ tSec, type: 'part-destroyed', mech: 0, instanceId, partId: 'R-C40', cause: 'damage' }) as BattleEvent;

function renderGrid(events: BattleEvent[], tSec: number, coreFrac = 1) {
  const { container } = render(
    <DamageGrid build={build} events={events} tSec={tSec} coreFrac={coreFrac} />,
  );
  return container;
}

describe('DamageGrid', () => {
  it('draws one square per chassis position', () => {
    const chassis = getChassis('CH-5');
    const container = renderGrid([], 0);
    expect(container.querySelectorAll('.dmg-grid i')).toHaveLength(chassis.width * chassis.height);
  });

  it('hatches a destroyed part rather than only recolouring it', () => {
    const before = renderGrid([destroyedAt(5, 'r1')], 1);
    expect(before.innerHTML).not.toContain('repeating-linear-gradient');

    // docs/14 §9: colour is never the only channel.
    const after = renderGrid([destroyedAt(5, 'r1')], 6);
    expect(after.innerHTML).toContain('repeating-linear-gradient');
  });

  it('ignores destruction that has not happened yet at this tick', () => {
    const container = renderGrid([destroyedAt(9, 'r1')], 3);
    expect(container.querySelector('.dmg')?.getAttribute('aria-label')).toContain('0 parts destroyed');
  });

  it('ignores the opponent losing parts', () => {
    const foeLoss = { ...destroyedAt(1, 'r1'), mech: 1 } as BattleEvent;
    const container = renderGrid([foeLoss], 5);
    expect(container.querySelector('.dmg')?.getAttribute('aria-label')).toContain('0 parts destroyed');
  });

  it('reports core state in the accessible name', () => {
    expect(renderGrid([], 0, 0.5).querySelector('.dmg')?.getAttribute('aria-label'))
      .toContain('core at 50%');
    // A dead core turns the cell red rather than dimming a blue one to nothing.
    expect(renderGrid([], 0, 0).innerHTML).toContain('--signal-red');
  });

  it('counts several losses', () => {
    const container = renderGrid([destroyedAt(1, 'r1'), destroyedAt(2, 'w1')], 5);
    expect(container.querySelector('.dmg')?.getAttribute('aria-label')).toContain('2 parts destroyed');
  });
});
