import { useEffect, useState } from 'react';

/** Literal --bp-md. @media cannot read custom properties, so the value repeats. */
export const BP_MD = 768;

/**
 * True at --bp-md and above, where docs/14 §11 says the sheets dock into rails.
 *
 * The sheets and the desktop rails are the same components either way -- what
 * changes is the container, not the content. A sheet is `position: fixed` with
 * dialog semantics, and a docked rail must not claim to be a dialog, so the
 * switch has to be observable to JS rather than CSS alone.
 */
export function useDocked(): boolean {
  const [docked, setDocked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(`(min-width: ${BP_MD}px)`).matches,
  );

  useEffect(() => {
    const query = window.matchMedia?.(`(min-width: ${BP_MD}px)`);
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => setDocked(e.matches);
    query.addEventListener('change', onChange);
    setDocked(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return Boolean(docked);
}
