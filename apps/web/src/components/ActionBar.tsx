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
  armedName, moving, reason, next, onCancel, onRotate, onPlace, onOpenParts, onOpenIntel,
}: {
  /** Null when nothing is armed. */
  armedName: string | null;
  /** True when the armed part came off the plate, so backing out discards it. */
  moving: boolean;
  /** Why the ghost cannot be placed; null when it can. */
  reason: string | null;
  onCancel: () => void;
  onRotate: () => void;
  onPlace: () => void;
  /** The coming fight, shown while idle. */
  next: { name: string; threat: 1 | 2 | 3 } | null;
  onOpenParts: () => void;
  onOpenIntel: () => void;
}) {
  if (!armedName) {
    return (
      <div className="actionbar armed">
        {next ? (
          <button className="next-strip" type="button" onClick={onOpenIntel}>
            <span className="next-k">Next</span>
            <span className="next-name">{next.name}</span>
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
          <button className="btn-primary" type="button" onClick={onOpenParts}>Parts</button>
        </span>
      </div>
    );
  }

  return (
    <div className="actionbar armed">
      <span className="armed-strip">
        <span className="armed-name">{moving ? 'Moving ' : ''}{armedName}</span>
        <span className={`armed-why ${reason ? '' : 'ok'}`}>{reason ?? 'Clear to place'}</span>
      </span>
      <span className="armed-controls">
        {/* A detached part is already off the plate, so backing out discards it. */}
        <button className={`btn ${moving ? 'btn-danger' : ''}`} type="button" onClick={onCancel}>
          {moving ? 'Discard' : 'Cancel'}
        </button>
        <button className="btn" type="button" onClick={onRotate}>Rotate</button>
        <button className="btn-primary" type="button" onClick={onPlace} disabled={Boolean(reason)}>
          Place
        </button>
      </span>
    </div>
  );
}
