import { useEffect, useRef, useState } from 'react';
import './ReadoutBar.css';

/**
 * Persistent 56px readout bar (docs/14 §8). Never scrolls away, mono
 * tabular-nums so columns do not shift as values change, and it announces new
 * faults -- BuildWarnings currently announces them to nobody.
 */
export function ReadoutBar({
  massT, ratedMassT, heatMarginKw, powerMarginKw, faultCount, onOpen,
}: {
  massT: number;
  ratedMassT: number;
  heatMarginKw: number | null;
  powerMarginKw: number;
  faultCount: number;
  onOpen: () => void;
}) {
  const [announce, setAnnounce] = useState('');
  const prevFaults = useRef(faultCount);

  useEffect(() => {
    // Only a *rise* is news. Fixing a fault does not need an interruption.
    if (faultCount > prevFaults.current) {
      setAnnounce(`${faultCount} ${faultCount === 1 ? 'fault' : 'faults'} on this build`);
    }
    prevFaults.current = faultCount;
  }, [faultCount]);

  const overMass = massT > ratedMassT;

  return (
    <>
      <div role="alert" aria-live="assertive" className="sr-only">{announce}</div>
      {/*
        If a surface is tappable, something on it must say so. An earlier
        revision opened the gauges from here but had no caret and no label, and
        read as a static strip -- the first reviewer reported there was "no way
        to look at heat and power". Hence the explicit Details affordance.
      */}
      <button type="button" className="readout-bar" onClick={onOpen} aria-label="Open build readout">
        <Cell label="Mass" value={`${massT.toFixed(2)}t`} tone={overMass ? 'bad' : 'ink'} />
        <Cell
          label="Heat"
          value={heatMarginKw === null ? '—' : `${heatMarginKw >= 0 ? '+' : ''}${heatMarginKw.toFixed(1)}`}
          tone={heatMarginKw !== null && heatMarginKw < 0 ? 'bad' : 'ink'}
        />
        <Cell
          label="Power"
          value={`${powerMarginKw >= 0 ? '+' : ''}${powerMarginKw.toFixed(1)}`}
          tone={powerMarginKw < 0 ? 'bad' : 'ink'}
        />
        <Cell
          label="Faults"
          value={String(faultCount)}
          tone={faultCount > 0 ? 'warn' : 'ink'}
        />
        <span className="readout-more">
          Details
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 8 L6 4 L10 8" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
      </button>
    </>
  );
}

/**
 * Signal colour only when the value is actionable. A nominal power margin is
 * ink, not green -- if everything healthy is green, green stops meaning anything.
 */
function Cell({ label, value, tone }: { label: string; value: string; tone: 'ink' | 'warn' | 'bad' }) {
  return (
    <span className="readout-cell">
      <span className="readout-label">{label}</span>
      <span className={`readout-value tone-${tone}`}>{value}</span>
    </span>
  );
}
