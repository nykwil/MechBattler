import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SAVE_VERSION, buildToMech, type RunInstance } from '@mechbattler/game';
import { TEMPLATES } from '@mechbattler/sim';
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

/**
 * A stored run carrying a real, legal mech.
 *
 * Built from a shipped template rather than hand-written coordinates: the first
 * version of this fixture put `x`/`y` at the top level instead of inside
 * `origin`, which every consumer read as an unplaced part. It passed anyway,
 * because nothing here validated the build — a fixture that is quietly wrong is
 * worse than a failing test.
 */
function storedRun(): RunInstance {
  const template = TEMPLATES.find((t) => t.build.chassisId === 'CH-5')!;
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
    mech: buildToMech(structuredClone(template.build)),
    bench: [],
    yardRerolled: false,
    events: [],
  } as unknown as RunInstance;
}

/** Every part id on the fixture's mech, in order. */
const fixtureParts = (): string[] => storedRun().mech.parts.map((p) => p.partId);

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

/**
 * A pre-spatial save addresses cells that mean something different now that
 * chassis have regions, so its parts land in the core or off the mask. It used
 * to load anyway, giving the player a mech that could not fight and no
 * explanation. Dropping it is the intended behaviour — this repo does not carry
 * migrations for old save data.
 */
describe('a save from before regions', () => {
  beforeEach(() => localStorage.clear());

  it('is discarded rather than loaded as an unplayable mech', () => {
    const legacy = storedRun();
    // Valid coordinates on the old flat grid; on a regioned CH-5 they are the
    // core cell and off-mask.
    (legacy as unknown as { mech: { parts: unknown[] } }).mech.parts = [
      { id: 'r1', partId: 'R-E25', origin: { x: 2, y: 2 }, rotation: 0, integrity: 1 },
      { id: 'w1', partId: 'W-MG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    render(<Harness />);

    expect(localStorage.getItem(STORAGE_KEY), 'the dead save should be cleared').toBeNull();
  });

  it('keeps a run whose mech is merely damaged or unpowered', () => {
    // The narrow-discard guarantee: only physically impossible builds go. A
    // stripped or browned-out mech is a game in progress, not corrupt data.
    const damaged = storedRun();
    const parts = (damaged as unknown as { mech: { parts: { integrity: number }[] } }).mech.parts;
    for (const part of parts) part.integrity = 0.05;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(damaged));

    render(<Harness />);

    expect(storedParts(), 'a damaged run is still a run').toEqual(fixtureParts());
  });
});

describe('reloading an active run', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRun()));
  });

  it('still has the saved mech in storage once the restore has settled', () => {
    render(<Harness />);
    expect(storedParts()).toEqual(fixtureParts());
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
