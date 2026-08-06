import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile, generateRunNodes } from '@mechbattler/game';
import { NewRunScreen, ProfileScreen, TitleScreen } from './GameFrontDoor.js';
import type { RunPhase } from '../state/runState.js';

afterEach(cleanup);

describe('game front door', () => {
  it('makes the run loop primary while preserving secondary modes', () => {
    const onNewRun = vi.fn();
    render(
      <TitleScreen
        run={{ phase: 'none' }}
        profile={defaultProfile()}
        onContinue={vi.fn()}
        onNewRun={onNewRun}
        onProfile={vi.fn()}
        onSandbox={vi.fn()}
        onBalance={vi.fn()}
        showIkDemo
      />,
    );
    expect(screen.getByRole('heading', { name: 'MECH BATTLER' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue run/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /New run/ }));
    expect(onNewRun).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Workshop Sandbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Balance Lab' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'IK Demo' }).getAttribute('href')).toBe(
      'http://127.0.0.1:5161/',
    );
  });

  it('hides the IK demo link outside development', () => {
    render(
      <TitleScreen
        run={{ phase: 'none' }}
        profile={defaultProfile()}
        onContinue={vi.fn()}
        onNewRun={vi.fn()}
        onProfile={vi.fn()}
        onSandbox={vi.fn()}
        onBalance={vi.fn()}
        showIkDemo={false}
      />,
    );
    expect(screen.queryByRole('link', { name: 'IK Demo' })).toBeNull();
  });

  it('shows a resumable run and locks sandbox mutation', () => {
    const active: RunPhase = {
      phase: 'active',
      data: {
        seed: 1,
        nodeIndex: 2,
        scrap: 42,
        fightsWon: 1,
        battlesCompleted: 1,
        earnedChassisIds: [],
        earnedPartIds: [],
        earnedChallengeIds: [],
        partProvenance: {},
        kitName: 'Vulture',
        generatedNodes: generateRunNodes(1),
        benchPool: [],
      },
    };
    render(
      <TitleScreen
        run={active}
        profile={defaultProfile()}
        onContinue={vi.fn()}
        onNewRun={vi.fn()}
        onProfile={vi.fn()}
        onSandbox={vi.fn()}
        onBalance={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Continue run/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workshop Sandbox' }).hasAttribute('disabled')).toBe(true);
  });

  it('loads saved mechs and only offers owned chassis for new builds', () => {
    const onLoadMech = vi.fn();
    render(
      <NewRunScreen
        profile={defaultProfile()}
        onLoadMech={onLoadMech}
        onCreateMech={vi.fn()}
        onDeleteMech={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    // Names the shipped factory blueprint, which moved to the Needle Skirmisher
    // in Aug 2026. The assertion that matters is unchanged: exactly one option,
    // and it is the only fit the fresh profile's unlocks make legal.
    expect(screen.getByText('Mule Needle Skirmisher')).toBeTruthy();
    expect(screen.queryByText('Vulture Skirmisher')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onLoadMech).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'factory-mule-needle', name: 'Mule Needle Skirmisher' }),
    );
  });

  it('shows declarative challenge progress and rewards', () => {
    render(<ProfileScreen profile={defaultProfile()} onBack={vi.fn()} />);
    expect(screen.getByText('First Blood')).toBeTruthy();
    expect(screen.getByText(/Unlocks: Lump/)).toBeTruthy();
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
  });
});
