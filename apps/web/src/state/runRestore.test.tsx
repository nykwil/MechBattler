import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SAVE_VERSION, type RunInstance } from '@mechbattler/game';
import { useBuild } from './useBuild.js';
import { useRun } from './runState.js';

/**
 * Reloading an active run must not lose the mech.
 *
 * The run snapshot is written by an effect that follows `build`, and the
 * reloaded build is fed back into the editor by a different effect that follows
 * `restored`. On the render where the run has been restored but `loadBuild` has
 * not yet landed, `build` is still the empty default frame -- so the persist
 * effect has a window in which it can serialise an empty mech over the saved
 * one. The two effects are coupled through render timing alone, which is not a
 * dependency anything can see.
 *
 * This test drives the real mount sequence rather than reasoning about it.
 */
const STORAGE_KEY = 'mechbattler-run-v4';

/** A stored run carrying a mech with real parts on it. */
function storedRun(): RunInstance {
  return {
    schemaVersion: GAME_SAVE_VERSION,
    id: 'run-test',
    seed: 4242,
    status: 'active',
    nodeIndex: 2,
    scrap: 60,
    fightsWon: 1,
    battlesCompleted: 1,
    kitName: 'Test kit',
    earnedChassisIds: [],
    earnedPartIds: [],
    earnedChallengeIds: [],
    generatedNodes: [],
    mech: {
      chassisId: 'CH-5',
      parts: [
        { id: 'r1', partId: 'R-E25', x: 2, y: 2, rotation: 0, integrity: 1 },
        { id: 'w1', partId: 'W-MG', x: 0, y: 0, rotation: 0, integrity: 1 },
      ],
      powerPriority: [],
    },
    bench: [],
    pendingSalvage: undefined,
    pendingModService: undefined,
    yardRerolled: false,
    events: [],
  } as unknown as RunInstance;
}

/**
 * The same two effects App.tsx mounts, in the same order, over the same hooks.
 * Nothing else from App is needed to reproduce the window.
 */
function Harness() {
  const { build, loadBuild } = useBuild('CH-5');
  const { restored, clearRestored, persistBuild, run } = useRun();

  // E2 -- restore a reloaded run's build into the editor, once.
  useEffect(() => {
    if (restored) {
      loadBuild(restored);
      clearRestored();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // E3 -- the run snapshot follows every edit and every run-data change.
  useEffect(() => {
    persistBuild(build);
  }, [build, run, persistBuild]);

  return null;
}

const storedParts = (): string[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return (JSON.parse(raw).mech?.parts ?? []).map((p: { partId: string }) => p.partId);
};

describe('reloading an active run', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRun()));
  });

  it('still has the saved mech in storage once the restore has settled', () => {
    render(<Harness />);
    expect(storedParts()).toEqual(['R-E25', 'W-MG']);
  });

  it('never writes an empty mech over the saved one, even transiently', () => {
    // A transient wipe is a real data loss: the tab can be closed, or another
    // tab can read storage, inside that window.
    let sawEmpty = false;
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patched(key: string, value: string) {
      if (key === STORAGE_KEY) {
        try {
          if ((JSON.parse(value).mech?.parts ?? []).length === 0) sawEmpty = true;
        } catch { /* not our shape */ }
      }
      return realSetItem.call(this, key, value);
    };
    try {
      render(<Harness />);
    } finally {
      Storage.prototype.setItem = realSetItem;
    }
    expect(sawEmpty, 'an empty mech was serialised over the saved run').toBe(false);
  });
});
