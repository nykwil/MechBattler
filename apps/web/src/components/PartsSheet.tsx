import { Sheet } from './Sheet.js';
import { PartPalette } from './PartPalette.js';

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
  return (
    <Sheet open={open} onClose={onClose} docked={docked} label="Parts" initialSnap="half">
      <PartPalette {...palette} />
    </Sheet>
  );
}
