import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getChassis } from '@mechbattler/sim';
import { Plate } from './Plate.js';

/**
 * The plate ported from the prototype. What matters is that the visual grouping
 * of a part into one silhouette never costs the interaction grid: every real cell
 * stays its own button, focus stop, and accessible name.
 */
function renderPlate(over: Partial<Parameters<typeof Plate>[0]> = {}) {
  const chassis = getChassis('CH-5');
  const { container } = render(
    <Plate
      chassis={chassis}
      parts={[]}
      overlay="parts"
      selectedInstanceId={null}
      ghostCells={[]}
      ghostLegal
      thermalSnapshot={null}
      onCellActivate={() => {}}
      {...over}
    />,
  );
  return { chassis, container };
}

const laser = { instanceId: 'l1', partId: 'W-LAS', origin: { x: 1, y: 1 }, rotation: 0 as const, integrity: 1 };

describe('Plate', () => {
  it('is a grid whose columns come from the chassis', () => {
    const { chassis, container } = renderPlate();
    const plate = container.querySelector('.plate') as HTMLElement;

    expect(plate.getAttribute('role')).toBe('grid');
    expect(plate.getAttribute('aria-colcount')).toBe(String(chassis.width));
    expect(plate.style.gridTemplateColumns).toBe(`repeat(${chassis.width}, var(--cell))`);
  });

  it('gives every real cell its own button and accessible name', () => {
    const { chassis, container } = renderPlate();
    const real = container.querySelectorAll('.cell:not(.void)');

    // A silhouette chassis: fewer cells than width x height.
    expect(real.length).toBeGreaterThan(0);
    expect(real.length).toBeLessThan(chassis.width * chassis.height);
    real.forEach((c) => {
      expect(c.tagName).toBe('BUTTON');
      expect(c.getAttribute('role')).toBe('gridcell');
      expect(c.getAttribute('aria-label')).toMatch(/column \d+, row \d+/);
    });
  });

  it('hides off-mask cells from assistive tech', () => {
    const { container } = renderPlate();
    container.querySelectorAll('.cell.void').forEach((c) => {
      expect(c.getAttribute('aria-hidden')).toBe('true');
      expect((c as HTMLButtonElement).tabIndex).toBe(-1);
    });
  });

  it('fuses a part into one silhouette with per-edge shadows', () => {
    const { container } = renderPlate({ parts: [laser] });
    const filled = [...container.querySelectorAll('.cell.filled')] as HTMLElement[];
    expect(filled.length).toBeGreaterThan(1);

    // Interior edges are omitted, so a multi-cell part has cells with fewer than
    // four inset shadows -- that is what makes it read as one shape.
    const counts = filled.map((c) => (c.style.boxShadow.match(/inset/g) ?? []).length);
    expect(Math.min(...counts)).toBeLessThan(4);
  });

  it('names the part and its power state in the cell label', () => {
    const { container } = renderPlate({ parts: [laser] });
    const label = container.querySelector('.cell.filled')?.getAttribute('aria-label') ?? '';

    // An unwired laser draws power and has no path to the core.
    expect(label).toContain('Ember');
    expect(label).toContain('unpowered');
  });

  it('hatches an unpowered part in the Parts view but not in Power', () => {
    const parts = renderPlate({ parts: [laser], overlay: 'parts' });
    expect(parts.container.querySelectorAll('.cell.unpowered').length).toBeGreaterThan(0);

    // Power view already says it in colour and position, so the hatch is noise.
    const power = renderPlate({ parts: [laser], overlay: 'power' });
    expect(power.container.querySelectorAll('.cell.unpowered').length).toBe(0);
  });

  it('marks the ghost legal or illegal', () => {
    const ok = renderPlate({ ghostCells: [{ x: 1, y: 1 }], ghostLegal: true });
    expect(ok.container.querySelector('.cell.ghost-ok')).not.toBeNull();

    const bad = renderPlate({ ghostCells: [{ x: 1, y: 1 }], ghostLegal: false });
    expect(bad.container.querySelector('.cell.ghost-bad')).not.toBeNull();
  });

  it('reports a tapped cell rather than acting on it', () => {
    const taps: [number, number][] = [];
    const { container } = renderPlate({ onCellActivate: (x, y) => taps.push([x, y]) });

    fireEvent.click(container.querySelectorAll('.cell:not(.void)')[0]);

    // Placement is the caller's decision: a tap only aims (docs/14 §6).
    expect(taps).toHaveLength(1);
  });

  it('shows the empty-chassis hint only while empty', () => {
    expect(renderPlate().container.querySelector('.empty-hint')).not.toBeNull();
    expect(renderPlate({ parts: [laser] }).container.querySelector('.empty-hint')).toBeNull();
  });
});
