import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './Sheet.css';

export type SheetSnap = 'peek' | 'half' | 'full';

const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full'];

/**
 * Bottom sheet (docs/14 §8). Snaps at peek / half / full; the plate stays
 * visible at peek and half so placement never loses context.
 *
 * The accessibility behaviour here is the point: role="dialog", aria-modal,
 * focus moved in on open and restored on close, Tab trapped, Esc to close. None
 * of that exists in the app's current modals.
 */
export function Sheet({
  open, onClose, label, children, initialSnap = 'half', docked = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  initialSnap?: SheetSnap;
  /**
   * At --bp-md the sheet docks as a rail (docs/14 §11). Same content, same
   * component -- but a rail is always present and is not a dialog, so it drops
   * role/aria-modal, the handle, the scrim, and the focus trap. Those exist to
   * manage a thing that covers the screen; a rail covers nothing.
   */
  docked?: boolean;
}) {
  const [snap, setSnap] = useState<SheetSnap>(initialSnap);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; moved: boolean } | null>(null);

  // Focus moves in on open and returns whence it came on close. A docked rail is
  // not an overlay, so it never steals focus.
  useEffect(() => {
    if (!open || docked) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setSnap(initialSnap);
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open, initialSnap, docked]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    // Trap: a modal sheet that lets Tab wander behind it is not modal.
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  }, [onClose]);

  function onHandlePointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, moved: false };
  }

  function onHandlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) < 24) return;
    drag.moved = true;
    drag.startY = e.clientY;
    setSnap((s) => {
      const i = SNAP_ORDER.indexOf(s);
      // Dragging down lowers the sheet; past peek it closes.
      if (dy > 0) {
        if (i === 0) { onClose(); return s; }
        return SNAP_ORDER[i - 1];
      }
      return SNAP_ORDER[Math.min(i + 1, SNAP_ORDER.length - 1)];
    });
  }

  function onHandlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    // A tap on the handle closes. In the prototype this control *is* the close
    // button -- `id="s-close"`, aria-label "Close parts" -- and the port made it
    // cycle snaps instead, which turned the sheet's only dismissal affordance into
    // a resize control and left peek and half with no way out at all. Dragging
    // still resizes; a tap ends the sheet, as it always did.
    if (drag && !drag.moved) onClose();
  }

  if (docked) {
    return (
      <section className="sheet-rail" aria-label={label}>
        <div className="sheet-body">{children}</div>
      </section>
    );
  }

  if (!open) return null;

  return (
    <div className="sheet-layer" onKeyDown={onKeyDown}>
      {/* The scrim is present at every snap, as the prototype's single scrim is
          (`scrim.classList.toggle('on', open)`). Rendering it only at full meant a
          tap outside a peek or half sheet hit nothing, so the sheet could not be
          dismissed by any means a phone has. It stays clear below full so the plate
          is still readable -- the reason it was dropped -- but it still takes the
          tap. Nothing on the plate is reachable behind an open sheet anyway:
          arming a part closes the sheet. */}
      <button
        className={`scrim on${snap === 'full' ? '' : ' scrim-clear'}`}
        type="button"
        tabIndex={-1}
        aria-label="Close sheet"
        onClick={onClose}
      />
      <div
        className={`sheet on sheet-${snap}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={panelRef}
        tabIndex={-1}
      >
        <button
          type="button"
          className="handle-zone"
          /* Named for the tap, which is what a screen reader user can actually do
             with it; dragging to resize is a pointer refinement on top. */
          aria-label={`Close ${label}`}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
        >
          <span className="handle" />
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
