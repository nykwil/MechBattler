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

const shotAt = (tSec: number, instanceId: string, damage: number): BattleEvent =>
  ({
    tSec, type: 'shot', mech: 1, instanceId: 'foeGun', partId: 'W-AC',
    hit: true, totalDamageDealt: damage,
    damaged: [{ instanceId, partId: 'R-C40', damage }],
  }) as BattleEvent;

describe('DamageGrid wear', () => {
  const opacityOf = (container: HTMLElement, nth: number) =>
    Number((container.querySelectorAll('.dmg-grid i')[nth] as HTMLElement).style.opacity || '1');

  /** The reactor sits at 1,1 on a 6-wide chassis, so its first cell is index 7. */
  const REACTOR_CELL = 7;

  it('fades a part as it takes damage', () => {
    const pristine = renderGrid([], 0);
    const hurt = renderGrid([shotAt(1, 'r1', 30)], 5);

    expect(opacityOf(hurt, REACTOR_CELL)).toBeLessThan(opacityOf(pristine, REACTOR_CELL));
  });

  it('ignores damage from later in the battle', () => {
    const before = renderGrid([shotAt(9, 'r1', 30)], 3);
    const after = renderGrid([shotAt(9, 'r1', 30)], 10);

    expect(opacityOf(before, REACTOR_CELL)).toBeGreaterThan(opacityOf(after, REACTOR_CELL));
  });

  it('ignores our own shots, which damage the opponent', () => {
    const ours = { ...shotAt(1, 'r1', 30), mech: 0 } as BattleEvent;
    expect(opacityOf(renderGrid([ours], 5), REACTOR_CELL))
      .toBe(opacityOf(renderGrid([], 5), REACTOR_CELL));
  });

  it('never fades below the floor that keeps a cell visible', () => {
    // Enough damage to overkill: the cell must still read as present, not vanish.
    const wrecked = renderGrid([shotAt(1, 'r1', 9999)], 5);
    expect(opacityOf(wrecked, REACTOR_CELL)).toBeCloseTo(0.3, 5);
  });

  it('skips core damage, which the core cell shows itself', () => {
    const coreHit = {
      ...shotAt(1, 'r1', 20),
      damaged: [{ instanceId: '__core__', partId: '__core__', damage: 20 }],
    } as BattleEvent;
    expect(opacityOf(renderGrid([coreHit], 5), REACTOR_CELL))
      .toBe(opacityOf(renderGrid([], 5), REACTOR_CELL));
  });
});
