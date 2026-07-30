import { useState } from 'react';
import type { PartCategory } from '@mechbattler/sim';
import { Sheet } from './Sheet.js';
import { PartPalette } from './PartPalette.js';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../lib/partVisuals.js';

/**
 * The Parts surface (docs/14 §2, §11). A bottom sheet on a phone; docked as the
 * left rail at --bp-md, which is how the desktop three-column layout re-emerges
 * from the mobile primitive instead of being a second implementation.
 */
export function PartsSheet({
  open, onClose, docked, ...palette
}: {
  open: boolean;
  onClose: () => void;
  docked: boolean;
} & Parameters<typeof PartPalette>[0]) {
  const [category, setCategory] = useState<PartCategory>('reactor');

  return (
    <Sheet open={open} onClose={onClose} docked={docked} label="Parts" initialSnap="half">
      <div className="sheet-head"><span className="sheet-title">Parts</span></div>
      {/* Tabbed by category, as the prototype is. Stacking all 22 rows put the
          radiators ~1900px down a scrolling sheet, which is not reachable by
          thumb in any useful sense. */}
      <div className="tabs" role="tablist" aria-label="Part category">
        {CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            className="tab"
            aria-selected={category === cat}
            onClick={() => setCategory(cat)}
          >
            {CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>
      <div className="sheet-body">
        <PartPalette {...palette} category={category} />
      </div>
    </Sheet>
  );
}
