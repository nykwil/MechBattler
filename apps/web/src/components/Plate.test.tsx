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
  it('labels the empty shoulder/body layout without covering an active build', () => {
    const empty = renderPlate();
    expect([...empty.container.querySelectorAll('.region-label')].map((node) => node.textContent))
      .toEqual(['Left shoulder', 'Body', 'Right shoulder']);

    const active = renderPlate({ parts: [laser] });
    expect(active.container.querySelector('.region-labels')).toBeNull();
  });

  it('shows separated regions, immutable ports, and layered routes', () => {
    const { container } = renderPlate({
      routes: [
        { kind: 'wire', regionId: 'body', x: 0, y: 2 },
        { kind: 'coolant', regionId: 'body', x: 0, y: 2 },
        { kind: 'wire', regionId: 'left-shoulder', x: 2, y: 1 },
        { kind: 'coolant', regionId: 'left-shoulder', x: 2, y: 1 },
        { kind: 'wire', regionId: 'body', x: 1, y: 2 },
        { kind: 'coolant', regionId: 'body', x: 1, y: 2 },
      ],
    });
    expect(container.querySelector('[data-region="body"][data-x="0"][data-y="2"]')
      ?.classList.contains('route-both')).toBe(true);
    const shoulderPort = container.querySelector(
      '[data-region="left-shoulder"][data-x="2"][data-y="1"]',
    );
    expect(shoulderPort?.classList.contains('port')).toBe(true);
    const busDownArm = shoulderPort?.querySelector('.route-path.bus .route-arm.route-down');
    expect(busDownArm).not.toBeNull();
    // `.down` is an unrelated status-chip class with padding; route directions
    // must stay namespaced or the vertical arm renders as a duplicate thick line.
    expect(busDownArm?.classList.contains('down')).toBe(false);
    expect(shoulderPort?.querySelector('.route-path.heat-pipe .route-arm.route-down')).not.toBeNull();
    expect(container.querySelectorAll('.port-link')).toHaveLength(2);
    const left = container.querySelector('[data-region="left-shoulder"][data-x="1"][data-y="0"]') as HTMLElement;
    const right = container.querySelector('[data-region="right-shoulder"][data-x="3"][data-y="0"]') as HTMLElement;
    const body = container.querySelector('[data-region="body"][data-x="0"][data-y="2"]') as HTMLElement;
    expect(left.style.gridColumn).toBe('2');
    expect(right.style.gridColumn).toBe('5');
    expect(body.style.gridRow).toBe('4');
    expect(body.style.transform).toBe('translate(50%, 0%)');
  });

  it('draws each route from its offset centre only toward connected neighbours', () => {
    const part = {
      instanceId: 'coupler', partId: 'U-CON',
      origin: { regionId: 'body', x: 1, y: 3 }, rotation: 0 as const, integrity: 1,
    };
    const { container } = renderPlate({
      parts: [part],
      routes: [
        { kind: 'wire', regionId: 'body', x: 0, y: 2 },
        { kind: 'wire', regionId: 'body', x: 0, y: 3 },
        { kind: 'coolant', regionId: 'body', x: 0, y: 3 },
      ],
    });
    const routed = container.querySelector(
      '[data-region="body"][data-x="0"][data-y="3"]',
    );

    expect(routed?.querySelector('.route-path.bus .route-arm.route-up')).not.toBeNull();
    expect(routed?.querySelector('.route-path.bus .route-arm.route-right')).not.toBeNull();
    expect(routed?.querySelector('.route-path.bus .route-arm.route-left')).toBeNull();
    expect(routed?.querySelector('.route-path.heat-pipe .route-arm.route-right')).not.toBeNull();
    expect(routed?.querySelector('.route-path.bus')).not.toBeNull();
    expect(routed?.querySelector('.route-path.heat-pipe')).not.toBeNull();
  });

  it('draws an energized port connection toward equipment fitted over its linked socket', () => {
    const portGun = {
      instanceId: 'port-gun', partId: 'W-MG',
      origin: { regionId: 'left-shoulder', x: 1, y: 1 }, rotation: 0 as const, integrity: 1,
    };
    const { container } = renderPlate({
      parts: [portGun],
      routes: [{ kind: 'wire', regionId: 'body', x: 1, y: 2 }],
    });
    const bodyPort = container.querySelector(
      '[data-region="body"][data-x="1"][data-y="2"]',
    );
    const gunPort = container.querySelector(
      '[data-region="left-shoulder"][data-x="2"][data-y="1"]',
    );

    expect(bodyPort?.querySelector('.route-path.bus .route-arm.route-up')).not.toBeNull();
    expect(gunPort?.classList.contains('filled')).toBe(true);
    expect(gunPort?.classList.contains('port')).toBe(true);
  });

  it('is a logical chassis grid rendered in the authored workshop layout', () => {
    const { chassis, container } = renderPlate();
    const plate = container.querySelector('.plate') as HTMLElement;

    expect(plate.getAttribute('role')).toBe('grid');
    expect(plate.getAttribute('aria-colcount')).toBe(String(chassis.width));
    expect(plate.style.gridTemplateColumns).toBe('repeat(7, var(--cell))');
    expect(plate.style.gridTemplateRows).toBe('repeat(7, var(--cell))');
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

  it('routes once across the complete pointer-down and click sequence', () => {
    const routed: [number, number][] = [];
    const activated: [number, number][] = [];
    const { container } = renderPlate({
      routeTool: 'wire',
      onRouteCell: (x, y) => routed.push([x, y]),
      onCellActivate: (x, y) => activated.push([x, y]),
    });
    const cell = container.querySelector('[data-region="body"][data-x="0"][data-y="2"]')!;

    // Browsers emit click after pointer-up. Routing owns pointer-down, so the
    // later click must not dispatch the same toggle a second time.
    fireEvent.pointerEnter(cell, { buttons: 1 });
    expect(routed).toEqual([]);
    // jsdom does not provide PointerEvent; MouseEvent still gives React the
    // primary-button fields for a pointerdown event.
    fireEvent(cell, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    fireEvent.click(cell);

    expect(routed).toEqual([[0, 2]]);
    expect(activated).toEqual([]);

    // Touch emulation and assistive activation can provide click without a
    // preceding pointerdown; that fallback must still paint exactly once.
    const fallbackCell = container.querySelector(
      '[data-region="body"][data-x="0"][data-y="3"]',
    )!;
    fireEvent.click(fallbackCell);
    expect(routed).toEqual([[0, 2], [0, 3]]);
  });

  it('shows the empty-chassis hint only while empty', () => {
    expect(renderPlate().container.querySelector('.empty-hint')).not.toBeNull();
    expect(renderPlate({ parts: [laser] }).container.querySelector('.empty-hint')).toBeNull();
  });
});

/**
 * Keyboard cursor, ported from the prototype's plate keydown handler. Without it
 * an unarmed keyboard user can only reach cells by tabbing through all of them in
 * document order, and cannot select a placed part at all.
 */
describe('Plate keyboard cursor', () => {
  it('walks focus across cells and skips the void', () => {
    const { container } = renderPlate();
    const plate = container.querySelector('.plate')!;
    const first = container.querySelector('.cell:not(.void)') as HTMLElement;
    first.focus();
    expect([first.dataset.x, first.dataset.y]).toEqual(['1', '0']);

    fireEvent.keyDown(plate, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement).dataset.x).toBe('2');

    // Down from the top row lands on a masked cell, never on a void one.
    fireEvent.keyDown(plate, { key: 'ArrowDown' });
    const active = document.activeElement as HTMLElement;
    expect(active.className).not.toContain('void');
  });

  it('activates the cell under the cursor on Enter', () => {
    const taps: [number, number][] = [];
    const { container } = renderPlate({ onCellActivate: (x, y) => taps.push([x, y]) });
    const plate = container.querySelector('.plate')!;

    fireEvent.keyDown(plate, { key: 'ArrowRight' });
    fireEvent.keyDown(plate, { key: 'Enter' });

    expect(taps).toEqual([[2, 0]]);
  });

  it('leaves the arrows to the ghost while a part is armed', () => {
    const taps: [number, number][] = [];
    const { container } = renderPlate({
      ghostCells: [{ x: 1, y: 1 }],
      onCellActivate: (x, y) => taps.push([x, y]),
    });
    const plate = container.querySelector('.plate')!;

    fireEvent.keyDown(plate, { key: 'ArrowRight' });
    fireEvent.keyDown(plate, { key: 'Enter' });

    // Armed, the global handler nudges and commits; the plate must not also act,
    // or one keypress would move the ghost twice.
    expect(taps).toEqual([]);
  });

  it('does not walk off the chassis', () => {
    const { container } = renderPlate();
    const plate = container.querySelector('.plate')!;
    const first = container.querySelector('.cell:not(.void)') as HTMLElement;
    first.focus();

    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(plate, { key: 'ArrowUp' });

    // Still on a real cell rather than focus lost to the document.
    expect((document.activeElement as HTMLElement).className).toContain('cell');
  });
});

describe('Plate accessibility structure', () => {
  it('gives every row child a gridcell role', () => {
    const { container } = renderPlate();
    for (const row of container.querySelectorAll('[role="row"]')) {
      for (const child of row.children) {
        // A row's children must all be gridcells; void positions are hidden
        // gridcells rather than roleless buttons sitting in the grid.
        expect(child.getAttribute('role')).toBe('gridcell');
      }
    }
  });

  it('makes void positions inert rather than unnamed controls', () => {
    const { container } = renderPlate();
    const voids = [...container.querySelectorAll('.cell.void')];
    expect(voids.length).toBeGreaterThan(0);
    for (const v of voids) {
      expect(v.tagName).toBe('SPAN');
      expect(v.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('names every interactive cell', () => {
    const { container } = renderPlate();
    for (const cell of container.querySelectorAll('button.cell')) {
      expect(cell.getAttribute('aria-label')).toMatch(/column \d+, row \d+/);
    }
  });
});
