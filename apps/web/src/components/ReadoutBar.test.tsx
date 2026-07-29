import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReadoutBar } from './ReadoutBar.js';

const base = {
  massT: 10, ratedMassT: 20, heatMarginKw: 5, powerMarginKw: 3,
  faultCount: 0, onOpen: () => {},
};

describe('ReadoutBar (docs/14 §8)', () => {
  it('says it is tappable', () => {
    const { container } = render(<ReadoutBar {...base} />);
    // Paid for in testing: with no caret and no label the bar read as a static
    // strip and a reviewer reported no way to reach heat and power.
    expect(container.querySelector('.readout-more')?.textContent).toContain('Details');
    expect(container.querySelector('.readout-bar')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('keeps a healthy margin in ink, not green', () => {
    const { container } = render(<ReadoutBar {...base} />);
    const values = [...container.querySelectorAll('.readout-value')];
    const power = values[2];

    // If everything healthy is green, green stops meaning anything.
    expect(power.className).toContain('tone-ink');
  });

  it('signals only actionable values', () => {
    const { container } = render(
      <ReadoutBar {...base} massT={25} heatMarginKw={-4} powerMarginKw={-2} faultCount={3} />,
    );
    const values = [...container.querySelectorAll('.readout-value')];

    expect(values[0].className).toContain('tone-bad'); // over rated mass
    expect(values[1].className).toContain('tone-bad'); // heat deficit
    expect(values[2].className).toContain('tone-bad'); // power deficit
    expect(values[3].className).toContain('tone-warn'); // faults present
  });

  it('announces a rise in fault count', () => {
    const { container, rerender } = render(<ReadoutBar {...base} faultCount={0} />);
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toBe('');

    rerender(<ReadoutBar {...base} faultCount={2} />);
    expect(alert.textContent).toContain('2 faults');
  });

  it('stays quiet when faults are fixed', () => {
    const { container, rerender } = render(<ReadoutBar {...base} faultCount={2} />);
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    rerender(<ReadoutBar {...base} faultCount={2} />);
    const afterSame = alert.textContent;

    rerender(<ReadoutBar {...base} faultCount={0} />);

    // Fixing a fault is not news worth interrupting a screen reader for.
    expect(alert.textContent).toBe(afterSame);
  });

  it('shows a dash when the build makes no heat', () => {
    const { container } = render(<ReadoutBar {...base} heatMarginKw={null} />);
    const values = [...container.querySelectorAll('.readout-value')];
    expect(values[1].textContent).toBe('—');
  });
});
