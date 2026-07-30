/**
 * The action bar, ported from the mobile builder prototype.
 *
 * Idle keeps the same two-row shape as armed, so the plate never resizes when a
 * part is armed -- the prototype's note, and the reason docs/14 §5 insists on a
 * fixed reserve rather than a grown row.
 */
export function ActionBar({
  armedName, moving, reason, onCancel, onRotate, onPlace, onOpenParts, idleHint, onAutoWire,
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
  onOpenParts: () => void;
  idleHint: string;
  onAutoWire: () => void;
}) {
  if (!armedName) {
    return (
      <div className="actionbar">
        <span className="armed-strip">
          <span className="armed-name">Nothing armed</span>
          <span className="armed-why">{idleHint}</span>
        </span>
        <span className="armed-controls">
          <button className="btn" type="button" onClick={onAutoWire}>Auto-wire</button>
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
