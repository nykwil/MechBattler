import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet.js';

/**
 * docs/14 §8 -- the sheet's dialog semantics are the point: none of them existed
 * in the app's current modals.
 */
describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    expect(container.querySelector('.sheet')).toBeNull();
  });

  it('is a labelled modal dialog', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    const panel = container.querySelector('.sheet') as HTMLElement;

    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Readout');
  });

  it('moves focus inside on open', () => {
    render(<Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>);
    // The handle is the first focusable, so focus lands in the sheet, not behind it.
    expect(document.activeElement?.className).toContain('handle-zone');
  });

  it('closes on Escape', () => {
    let closed = false;
    const { container } = render(
      <Sheet open onClose={() => { closed = true; }} label="Readout"><button>inner</button></Sheet>,
    );
    fireEvent.keyDown(container.querySelector('.sheet-layer')!, { key: 'Escape' });
    expect(closed).toBe(true);
  });

  it('traps Tab inside the sheet', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    // Scoped to the panel: the scrim is a button too, but it lives outside the
    // trap and carries tabIndex -1.
    const focusable = [...container.querySelectorAll<HTMLElement>('.sheet button')];
    const last = focusable[focusable.length - 1];
    last.focus();

    fireEvent.keyDown(container.querySelector('.sheet-layer')!, { key: 'Tab' });

    // Wrapping to the first control means Tab never wanders behind a modal.
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('opens at half, over a scrim that is present but clear', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    expect(container.querySelector('.sheet')?.className).toContain('sheet-half');
    // Present at every snap, or a tap outside a half sheet lands on nothing and
    // the sheet cannot be dismissed by any means a phone has. Clear, so the plate
    // behind stays readable.
    const scrim = container.querySelector('.scrim');
    expect(scrim).not.toBeNull();
    expect(scrim?.className).toContain('scrim-clear');
  });

  it('is dismissed by a tap outside at every snap, not only at full', () => {
    for (const snap of ['peek', 'half', 'full'] as const) {
      let closed = false;
      const { container, unmount } = render(
        <Sheet open initialSnap={snap} onClose={() => { closed = true; }} label="Readout">
          <button>inner</button>
        </Sheet>,
      );

      fireEvent.click(container.querySelector('.scrim')!);

      expect(closed, snap).toBe(true);
      unmount();
    }
  });

  it('closes on a handle tap, which is what the handle is for', () => {
    // In the prototype this control is `id="s-close"`, labelled "Close parts".
    // Cycling snaps here left the sheet with no dismissal affordance at all.
    let closed = false;
    const { container } = render(
      <Sheet open onClose={() => { closed = true; }} label="Readout"><button>inner</button></Sheet>,
    );
    const handle = container.querySelector('.handle-zone')!;

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle);

    expect(closed).toBe(true);
  });

  it('resizes rather than closes when the handle is dragged', () => {
    let closed = false;
    const { container } = render(
      <Sheet open onClose={() => { closed = true; }} label="Readout"><button>inner</button></Sheet>,
    );
    const handle = container.querySelector('.handle-zone')!;

    fireEvent.pointerDown(handle, { clientY: 300 });
    fireEvent.pointerMove(handle, { clientY: 260 });
    fireEvent.pointerUp(handle);

    expect(container.querySelector('.sheet')?.className).toContain('sheet-full');
    expect(closed).toBe(false);
  });
});

describe('Sheet docking (docs/14 §11)', () => {
  it('becomes a rail rather than a dialog when docked', () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} docked label="Parts"><button>inner</button></Sheet>,
    );

    // A rail covers nothing, so the dialog machinery would be a lie: no role,
    // no modal, no handle, no scrim.
    const rail = container.querySelector('.sheet-rail') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.getAttribute('aria-label')).toBe('Parts');
    expect(rail.getAttribute('role')).toBeNull();
    expect(rail.getAttribute('aria-modal')).toBeNull();
    expect(container.querySelector('.handle-zone')).toBeNull();
    expect(container.querySelector('.scrim')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows docked content even while closed', () => {
    // The rail is always present; `open` only governs the overlay presentation.
    const { container } = render(
      <Sheet open={false} onClose={() => {}} docked label="Parts"><button>inner</button></Sheet>,
    );
    expect(container.textContent).toContain('inner');
  });

  it('does not steal focus when docked', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(<Sheet open docked onClose={() => {}} label="Parts"><button>inner</button></Sheet>);

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('still renders the dialog when not docked', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Parts"><button>inner</button></Sheet>,
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('.sheet-rail')).toBeNull();
  });
});

describe('PartsSheet category tabs', () => {
  const palette = {
    selectedPartId: null,
    onSelect: () => {},
    onHover: () => {},
    label: 'Sandbox catalog',
  };

  it('shows one category at a time, so the list stays reachable', async () => {
    const { PartsSheet } = await import('./PartsSheet.js');
    const { container } = render(
      <PartsSheet open onClose={() => {}} docked={false} {...palette} />,
    );

    const tabs = [...container.querySelectorAll('.tabs .tab')];
    expect(tabs.map((t) => t.textContent))
      .toEqual(['Reactor', 'Capacitor', 'Weapon', 'Utility', 'Structural']);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);

    // Reactors only: the full catalogue is 22 rows, which is what put the
    // radiators ~1900px down a scrolling sheet.
    const rows = container.querySelectorAll('.part-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(8);
  });

  it('switches category on tab press', async () => {
    const { PartsSheet } = await import('./PartsSheet.js');
    const { container } = render(
      <PartsSheet open onClose={() => {}} docked={false} {...palette} />,
    );
    const before = [...container.querySelectorAll('.part-row')].map((r) => r.textContent);

    const utility = [...container.querySelectorAll('.tabs .tab')]
      .find((t) => t.textContent === 'Utility')!;
    fireEvent.click(utility);

    const after = [...container.querySelectorAll('.part-row')].map((r) => r.textContent);
    expect(after).not.toEqual(before);
    expect(after.join(' ')).toContain('Gill');
    expect(utility.getAttribute('aria-selected')).toBe('true');
  });

  it('drops the per-category heading it would only repeat', async () => {
    const { PartsSheet } = await import('./PartsSheet.js');
    const { container } = render(
      <PartsSheet open onClose={() => {}} docked={false} {...palette} />,
    );
    // The tab already names the category and the sheet already has a title.
    expect(container.querySelector('.category-label')).toBeNull();
    expect(container.querySelector('.sheet-title')?.textContent).toBe('Parts');
  });
});
