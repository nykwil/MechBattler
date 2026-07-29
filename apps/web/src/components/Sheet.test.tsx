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
    expect(document.activeElement?.className).toContain('sheet-handle');
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
    expect(container.querySelector('.sheet-scrim')).toBeNull();
  });

  it('cycles snap on a handle tap and scrims only at full', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} label="Readout"><button>inner</button></Sheet>,
    );
    const handle = container.querySelector('.sheet-handle')!;

    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle);

    expect(container.querySelector('.sheet')?.className).toContain('sheet-full');
    expect(container.querySelector('.sheet-scrim')).not.toBeNull();
  });
});
