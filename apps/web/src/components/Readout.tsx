import { useEffect, useRef, useState } from 'react';

/**
 * The 56px readout, ported from the mobile builder prototype. Its markup is the
 * prototype's: .ro-cell / .ro-k / .ro-v / .ro-d, with deltas on their own line so
 * a preview can never push the value out of the cell.
 */
export function Readout({
  massT, ratedMassT, powerMarginKw, heatMarginKw, faultCount, preview, onOpen,
}: {
  massT: number;
  ratedMassT: number;
  powerMarginKw: number;
  heatMarginKw: number | null;
  faultCount: number;
  /** Hovered/armed part's projected figures, shown as deltas. */
  preview: { massT: number; powerMarginKw: number } | null;
  onOpen: () => void;
}) {
  const [announce, setAnnounce] = useState('');
  const prevFaults = useRef(faultCount);

  useEffect(() => {
    // Only a rise is news; fixing a fault needs no interruption.
    if (faultCount > prevFaults.current) {
      setAnnounce(`${faultCount} ${faultCount === 1 ? 'fault' : 'faults'} on this build`);
    }
    prevFaults.current = faultCount;
  }, [faultCount]);

  const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

  return (
    <>
      <p className="sr" role="status" aria-live="polite">{announce}</p>
      <button className="readout" type="button" onClick={onOpen} aria-label="Open full readout">
        <Cell
          k="Mass"
          v={<>{massT.toFixed(2)}<span className="ro-unit">t</span></>}
          cls={massT > ratedMassT ? 'bad' : ''}
          d={preview ? `→ ${preview.massT.toFixed(2)}` : ''}
        />
        <Cell
          k="Power"
          v={signed(powerMarginKw)}
          cls={powerMarginKw < 0 ? 'bad' : powerMarginKw > 0 ? 'good' : ''}
          d={preview ? `→ ${signed(preview.powerMarginKw)}` : ''}
        />
        <Cell
          k="Heat"
          v={heatMarginKw === null ? '—' : signed(heatMarginKw)}
          cls={heatMarginKw !== null && heatMarginKw < 0 ? 'warn' : ''}
          d=""
        />
        <Cell k="Faults" v={String(faultCount)} cls={faultCount ? 'bad' : 'good'} d="" />
        <span className="ro-more">
          <span className="caret" aria-hidden="true">▴</span>
        </span>
      </button>
    </>
  );
}

function Cell({ k, v, cls, d }: { k: string; v: React.ReactNode; cls: string; d: string }) {
  return (
    <span className="ro-cell">
      <span className="ro-k">{k}</span>
      <span className={`ro-v ${cls}`}>{v}</span>
      {d && <span className="ro-d">{d}</span>}
    </span>
  );
}
