/**
 * The action bar, ported from the mobile builder prototype.
 *
 * Idle keeps the same shape as armed so the plate never resizes, and the strip is
 * spent on the thing you are building *against* -- the prototype's own words. That
 * is where §8's intel strip lives: it names the opponent and threat, and tapping
 * it opens the detail, because the loop is read the opponent, move a radiator,
 * read it again. Making that a navigation would cost the loop.
 *
 * The bar keeps the `armed` class in both states; it governs height, not arming.
 */
export function ActionBar({
  armedName, moving, stows, reason, preview, next, prep, prepReady, onLaunch,
  onCancel, onRotate, onPlace, onOpenParts, onOpenIntel,
}: {
  /** Null when nothing is armed. */
  armedName: string | null;
  /** True when the armed part came off the plate, so backing out discards it. */
  moving: boolean;
  /** Backing out returns the part to the bench rather than destroying it. */
  stows: boolean;
  /** Why the ghost cannot be placed; null when it can. */
  reason: string | null;
  /** Effective location facts for a legal ghost placement. */
  preview?: string | null;
  onCancel: () => void;
  onRotate: () => void;
  onPlace: () => void;
  /** The coming fight, shown while idle. */
  next: { name: string; threat: 1 | 2 | 3 } | null;
  /**
   * True while the run is outfitted but not launched. A fight taken here is a
   * trial: it is deliberately free play, so it pays no purse, drops no salvage
   * and advances no node. That is a reasonable rule and it was completely
   * invisible — the strip said "Next", offered a fight, and a player could win
   * it and be left on a report screen with nothing to do and no idea why.
   */
  prep?: boolean;
  /** Whether the prep build is legal to launch (budget, a weapon, a reactor). */
  prepReady?: boolean;
  /**
   * Starts the run. Offered here because the only other way in was the readout
   * sheet's run tab, three taps deep with nothing pointing at it — explaining
   * how to begin a run took ten steps and a warning about the fifth. A player
   * who has loaded a mech and is looking at the fight strip is exactly the
   * player who wants this button.
   */
  onLaunch?: () => void;
  onOpenParts: () => void;
  onOpenIntel: () => void;
}) {
  if (!armedName) {
    return (
      <div className="actionbar armed">
        {next ? (
          <button className="next-strip" type="button" onClick={onOpenIntel}>
            <span className="next-k">{prep ? 'Trial' : 'Next'}</span>
            <span className="next-name">
              {next.name}{prep ? ' · run not launched' : ''}
            </span>
            <span className="threat" aria-label={`Threat ${next.threat} of 3`}>
              <span aria-hidden="true">{'▲'.repeat(next.threat)}</span>
              <span className="threat-off" aria-hidden="true">{'▲'.repeat(3 - next.threat)}</span>
            </span>
            <span className="next-caret" aria-hidden="true">›</span>
          </button>
        ) : (
          <span className="next-strip">
            <span className="next-k">Sandbox</span>
            <span className="next-name">No fight queued</span>
          </span>
        )}
        <span className="armed-controls">
          {prep && onLaunch ? (
            <>
              <button className="btn" type="button" onClick={onOpenParts}>Parts</button>
              <button
                className="btn-primary"
                type="button"
                onClick={onLaunch}
                disabled={!prepReady}
                title={prepReady ? undefined : 'Needs a reactor, a weapon, and to be inside the tier budget'}
              >
                Launch run
              </button>
            </>
          ) : (
            <button className="btn-primary" type="button" onClick={onOpenParts}>Parts</button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="actionbar armed">
      <span className="armed-strip">
        <span className="armed-name">{moving ? 'Moving ' : ''}{armedName}</span>
        <span className={`armed-why ${reason ? '' : 'ok'}`}>{reason ?? preview ?? 'Clear to place'}</span>
      </span>
      <span className="armed-controls">
        {/* A detached part is already off the plate, so backing out has to say
            where it goes: to the bench during a run, and away in free play. */}
        <button className={`btn ${moving && !stows ? 'btn-danger' : ''}`} type="button" onClick={onCancel}>
          {moving ? (stows ? 'Stow' : 'Discard') : 'Cancel'}
        </button>
        <button className="btn" type="button" onClick={onRotate}>Rotate</button>
        <button className="btn-primary" type="button" onClick={onPlace} disabled={Boolean(reason)}>
          Place
        </button>
      </span>
    </div>
  );
}
