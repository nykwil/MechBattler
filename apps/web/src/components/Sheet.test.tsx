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
    const focusable = [...container.querySelectorAll<HTMLElement>('button')];
    const last = focusable[focusable.length - 1];
    last.focus();

    fireEvent.keyDown(container.querySelector('.sheet-layer')!, { key: 'Tab' });

    // Wrapping to the first control means Tab never wanders behind a modal.
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('opens at half so the plate stays visible', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    expect(container.querySelector('.sheet')?.className).toContain('sheet-half');
    // No scrim at half: the plate behind must stay usable.
    expect(container.querySelector('.scrim')).toBeNull();
  });

  it('cycles snap on a handle tap and scrims only at full', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    const handle = container.querySelector('.handle-zone')!;

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle);

    expect(container.querySelector('.sheet')?.className).toContain('sheet-full');
    expect(container.querySelector('.scrim')).not.toBeNull();
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
