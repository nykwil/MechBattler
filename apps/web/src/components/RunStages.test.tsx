import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATES } from '@mechbattler/sim';
import {
  createRun,
  defaultProfile,
  type PendingSalvage,
} from '@mechbattler/game';
import { WreckScreen } from './WreckScreen.js';
import { RunPanel } from './RunPanel.js';
import type { RunData, RunPhase } from '../state/runState.js';

afterEach(cleanup);

const template = TEMPLATES.find((candidate) => candidate.id === 'vulture-skirmisher')!;

function runData(): RunData {
  const domain = createRun({ seed: 42, kitName: 'Scout', build: template.build });
  return {
    seed: domain.seed,
    nodeIndex: domain.nodeIndex,
    scrap: domain.scrap,
    fightsWon: domain.fightsWon,
    battlesCompleted: domain.battlesCompleted,
    kitName: domain.kitName,
    generatedNodes: domain.generatedNodes,
    earnedChassisIds: domain.earnedChassisIds,
    earnedPartIds: domain.earnedPartIds,
    earnedChallengeIds: domain.earnedChallengeIds,
    partProvenance: Object.fromEntries(domain.mech.parts.map((part) => [part.id, part.provenance])),
    benchPool: [],
  };
}

function renderRun(run: RunPhase, overrides: Partial<Parameters<typeof RunPanel>[0]> = {}) {
  const props: Parameters<typeof RunPanel>[0] = {
    run,
    build: template.build,
    onStartKit: vi.fn(),
    onFight: vi.fn(),
    onAbandon: vi.fn(),
    onNewRun: vi.fn(),
    onSellBench: vi.fn(),
    onFitBench: vi.fn(),
    fittingBenchIndex: null,
    onBuyOffer: vi.fn(),
    onRerollYard: vi.fn(),
    onSkipNode: vi.fn(),
    onRepairAll: vi.fn(),
    onRepairBench: vi.fn(),
    modTargets: [],
    onApplyMilestoneMod: vi.fn(),
    onSkipModService: vi.fn(),
    profile: defaultProfile(),
    history: [],
    onStartCustom: vi.fn(),
    onLaunch: vi.fn(),
    ...overrides,
  };
  return render(<RunPanel {...props} />);
}

describe('persistent run stages', () => {
  it('settles a stored wreck from purse and untaken-part values', () => {
    const pending: PendingSalvage = {
      opponentName: 'Target',
      opponentChassisId: 'CH-2',
      purse: 25,
      candidates: [
        {
          id: 'intact',
          partId: 'W-MG',
          integrity: 0.5,
          provenance: { source: 'salvage' },
          origin: { x: 0, y: 0 },
          rotation: 0,
          destroyed: false,
          scrapValue: 4,
        },
        {
          id: 'destroyed',
          partId: 'U-ARM',
          integrity: 0,
          provenance: { source: 'salvage' },
          origin: { x: 1, y: 0 },
          rotation: 0,
          destroyed: true,
          scrapValue: 4,
        },
      ],
    };
    const onFinish = vi.fn();
    render(<WreckScreen pending={pending} benchUsed={0} onFinish={onFinish} />);
    fireEvent.click(screen.getByRole('button', { name: /Stitcher/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Strip the wreck' }));
    expect(onFinish).toHaveBeenCalledWith(
      29,
      [expect.objectContaining({ id: 'intact', partId: 'W-MG', integrity: 0.5 })],
    );
  });

  it('blocks node selection behind a milestone mod service', () => {
    const onSkipModService = vi.fn();
    const data = {
      ...runData(),
      fightsWon: 3,
      pendingModService: { afterWin: 3, offerIds: ['cold-bore'], applied: false },
    };
    const weapon = template.build.parts.find((part) => part.partId === 'W-CB')!;
    renderRun(
      { phase: 'active', data },
      {
        modTargets: [{
          id: weapon.instanceId,
          partId: weapon.partId,
          label: 'Carbine',
          modifiers: weapon.modifiers,
        }],
        onSkipModService,
      },
    );
    expect(screen.getByText('◆ MACHINIST MILESTONE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this service' }));
    expect(onSkipModService).toHaveBeenCalledOnce();
  });

  it('offers paid repairs for installed and benched parts between rounds', () => {
    const onRepairAll = vi.fn();
    const onRepairBench = vi.fn();
    const damagedBuild = {
      ...template.build,
      parts: template.build.parts.map((part, index) =>
        index === 0 ? { ...part, integrity: 0.5 } : part),
    };
    const data = {
      ...runData(),
      scrap: 100,
      benchPool: [{
        id: 'bench-damaged',
        partId: 'W-MG',
        integrity: 0.5,
        provenance: { source: 'salvage' as const },
      }],
    };
    renderRun(
      { phase: 'active', data },
      { build: damagedBuild, onRepairAll, onRepairBench },
    );
    fireEvent.click(screen.getByRole('button', { name: /repair all/ }));
    expect(onRepairAll).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /^repair −/ }));
    expect(onRepairBench).toHaveBeenCalledWith(0);
  });

  it('includes earned progression in the memorial', () => {
    const data = {
      ...runData(),
      fightsWon: 4,
      earnedPartIds: ['W-AC'],
      earnedChallengeIds: ['first-blood'],
    };
    renderRun({
      phase: 'over',
      data,
      cause: 'Core destroyed by Target',
      victorious: false,
    });
    expect(screen.getByText(/Earned: First Blood · Judge/)).toBeTruthy();
  });
});
