import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATES, getChassis } from '@mechbattler/sim';
import { createRun } from '@mechbattler/game';
import { ReadoutSheet } from './ReadoutSheet.js';
import { RunPanel } from './RunPanel.js';
import type { RunData, RunPhase } from '../state/runState.js';

afterEach(cleanup);

const template = TEMPLATES.find((c) => c.id === 'vulture-skirmisher')!;

function runData(over: Partial<RunData> = {}): RunData {
  const d = createRun({ seed: 42, kitName: 'Scout', build: template.build });
  return {
    seed: d.seed, nodeIndex: d.nodeIndex, scrap: d.scrap, fightsWon: d.fightsWon,
    battlesCompleted: d.battlesCompleted, kitName: d.kitName,
    generatedNodes: d.generatedNodes,
    earnedChassisIds: d.earnedChassisIds, earnedPartIds: d.earnedPartIds,
    earnedChallengeIds: d.earnedChallengeIds,
    partProvenance: Object.fromEntries(d.mech.parts.map((p) => [p.id, p.provenance])),
    benchPool: [],
    ...over,
  };
}

/**
 * A lost core ends the run. Driving that in a browser is not reliable: the branch
 * fires, but five attempts with a mech stripped to guns and a reactor all ended in
 * mission-kill or judges instead, which keep the node. So the two things the fix
 * actually changed are pinned here rather than hunted.
 */
describe('a run that has ended', () => {
  const over: RunPhase = {
    phase: 'over',
    data: runData({ fightsWon: 2 }),
    cause: 'Core destroyed by Copper Vulture Sniper',
    victorious: false,
  };

  it('names the cause and the tally on the memorial', () => {
    const props: Parameters<typeof RunPanel>[0] = {
      run: over,
      build: template.build,
      onFight: vi.fn(), onAbandon: vi.fn(), onNewRun: vi.fn(),
      onSellBench: vi.fn(), onFitBench: vi.fn(), fittingBenchIndex: null,
      onBuyOffer: vi.fn(), onRerollYard: vi.fn(), onSkipNode: vi.fn(),
      onRepairAll: vi.fn(), onRepairBench: vi.fn(), modTargets: [],
      onApplyMilestoneMod: vi.fn(), onSkipModService: vi.fn(),
      onLaunch: vi.fn(), onSaveMech: vi.fn(), editingSavedMechId: null,
    };
    render(<RunPanel {...props} />);

    expect(screen.getByText('✕ CORE DESTROYED')).toBeTruthy();
    expect(screen.getByText(/2 fights won/)).toBeTruthy();
    expect(screen.getByText('Core destroyed by Copper Vulture Sniper')).toBeTruthy();
  });
});

describe('readout sheet initial tab', () => {
  const sheet = (props: Partial<Parameters<typeof ReadoutSheet>[0]>) => (
    <ReadoutSheet
      open chassis={getChassis(template.build.chassisId)} build={template.build}
      parts={template.build.parts} powerPriority={template.build.powerPriority}
      issues={[]} onClose={vi.fn()} onMovePriority={vi.fn()} onBenchResult={vi.fn()}
      {...props}
    />
  );

  const selected = () => [...document.querySelectorAll('.readout-tab')]
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

  it('opens on vitals when the caller names no tab', () => {
    render(sheet({}));
    expect(selected()).toBe('vitals');
  });

  it('opens on the tab the caller names', () => {
    render(sheet({ initialTab: 'power' }));
    expect(selected()).toBe('power');
  });

  it('applies the named tab again on each open, not only at mount', () => {
    // The sheet stays mounted while closed, so reading initialTab once meant a
    // sheet already opened on vitals ignored it -- exactly when the run has just
    // ended and the memorial is the thing worth showing.
    const { rerender } = render(sheet({ open: false, initialTab: 'power' }));
    rerender(sheet({ open: true, initialTab: 'power' }));
    expect(selected()).toBe('power');

    // Move away, close, reopen: the named tab wins again.
    fireEvent.click([...document.querySelectorAll('.readout-tab')][0]!);
    expect(selected()).toBe('vitals');
    rerender(sheet({ open: false, initialTab: 'power' }));
    rerender(sheet({ open: true, initialTab: 'power' }));
    expect(selected()).toBe('power');
  });
});
