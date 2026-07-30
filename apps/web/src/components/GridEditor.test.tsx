import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getChassis } from '@mechbattler/sim';
import { GridEditor } from './GridEditor.js';

/**
 * docs/14 §5 -- the plate. Cell size is derived in CSS from --cols against the
 * container width, so what the component owes the stylesheet is: the column and
 * row counts, and a viewBox that lets the fixed CELL coordinate system scale to
 * whatever width that derivation produces.
 */
function renderPlate(
  chassisId: string,
  opts: {
    ghost?: { x: number; y: number } | null;
    detached?: boolean;
    onAim?: (x: number, y: number) => void;
    onCommit?: () => void;
    checkCandidate?: () => { reason: string } | null;
  } = {},
) {
  const chassis = getChassis(chassisId);
  const { ghost = null, detached = false, onAim, onCommit } = opts;
  const { container } = render(
    <GridEditor
      chassis={chassis}
      parts={[]}
      overlay="parts"
      selectedPartId={ghost ? 'U-CON' : null}
      selectedInstanceId={null}
      previewCells={() => []}
      checkCandidate={opts.checkCandidate ?? (() => null)}
      ghost={ghost}
      detached={detached}
      onAim={onAim ?? (() => {})}
      onCommit={onCommit ?? (() => {})}
      onCancel={() => {}}
      onRotate={() => {}}
      onSetOverlay={() => {}}
      onSelectInstance={() => {}}
      thermalSnapshot={null}
      faultInstanceIds={new Set()}
      flashInstanceIds={new Set()}
      onAutoWire={() => {}}
    />,
  );
  return { chassis, container };
}

describe('GridEditor plate sizing', () => {
  it('publishes grid dimensions for the CSS cell-size derivation', () => {
    const { chassis, container } = renderPlate('CH-5');
    const frame = container.querySelector('.grid-frame') as HTMLElement;

    expect(frame.style.getPropertyValue('--cols')).toBe(String(chassis.width));
    expect(frame.style.getPropertyValue('--rows')).toBe(String(chassis.height));
  });

  it('scales through a viewBox rather than a fixed pixel width', () => {
    const { chassis, container } = renderPlate('CH-5');
    const svg = container.querySelector('.grid-svg') as SVGSVGElement;

    // A fixed width/height would pin the plate to one size and defeat §5.
    expect(svg.getAttribute('width')).toBeNull();
    expect(svg.getAttribute('height')).toBeNull();
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${chassis.width * 30} ${chassis.height * 30}`);
  });

  it('keeps every cell an independent tap target under the part outline', () => {
    const { chassis, container } = renderPlate('CH-5');

    // §5: the single silhouette outline must never cost the interaction grid.
    // The outline being non-interactive is a CSS fact (pointer-events: none) that
    // jsdom cannot see, so what is asserted here is the part that matters and is
    // observable: every rendered cell has its own hit target.
    // A chassis is a silhouette, so only masked-in cells exist -- CH-5 is 6x6
    // but 32 cells. Every cell that renders must also be independently hittable.
    const rendered = container.querySelectorAll('.cell-bg, .cell-core');
    const hits = container.querySelectorAll('.cell-hit');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(chassis.width * chassis.height);
    expect(hits.length).toBe(rendered.length);
  });
});

describe('GridEditor tap-then-confirm placement (docs/14 §6)', () => {
  it('aims instead of placing when an armed cell is tapped', () => {
    const aimed: [number, number][] = [];
    const committed: string[] = [];
    const { container } = renderPlate('CH-5', {
      ghost: { x: 0, y: 0 },
      onAim: (x, y) => aimed.push([x, y]),
      onCommit: () => committed.push('commit'),
    });

    const hits = container.querySelectorAll('.cell-hit');
    fireEvent.click(hits[5]);

    // A fingertip covers the target, so a tap must never commit by itself.
    expect(aimed).toHaveLength(1);
    expect(committed).toHaveLength(0);
  });

  it('offers exactly three armed controls and no nudge pad', () => {
    const { container } = renderPlate('CH-5', { ghost: { x: 0, y: 0 } });
    const labels = [...container.querySelectorAll('.plate-armed .plate-btn')]
      .map((b) => b.textContent);

    expect(labels).toEqual(['Cancel', 'Rotate', 'Place']);
  });

  it('shows no armed controls until something is armed', () => {
    const { container } = renderPlate('CH-5');
    expect(container.querySelector('.plate-armed')).toBeNull();
  });

  it('disables Place while illegal and names the reason above it', () => {
    const { container } = renderPlate('CH-5', {
      ghost: { x: 0, y: 0 },
      checkCandidate: () => ({ reason: 'overlap' }),
    });

    const place = container.querySelector('.plate-btn-primary') as HTMLButtonElement;
    expect(place.disabled).toBe(true);

    // A disabled control must never be a mystery.
    const reason = container.querySelector('.plate-armed-reason');
    expect(reason?.textContent).toContain('cell already occupied');
  });

  it('enables Place once the ghost is legal', () => {
    const { container } = renderPlate('CH-5', { ghost: { x: 0, y: 0 } });
    const place = container.querySelector('.plate-btn-primary') as HTMLButtonElement;
    expect(place.disabled).toBe(false);
  });
});

describe('GridEditor detach affordances (docs/14 §7)', () => {
  it('reads Discard, not Cancel, once the part is off the plate', () => {
    const { container } = renderPlate('CH-5', { ghost: { x: 0, y: 0 }, detached: true });
    const labels = [...container.querySelectorAll('.plate-armed .plate-btn')]
      .map((b) => b.textContent);

    // Backing out has nothing to return the part to, so the word changes.
    expect(labels).toEqual(['Discard', 'Rotate', 'Place']);
  });

  it('gives Discard the danger style and Cancel none', () => {
    const detachedPlate = renderPlate('CH-5', { ghost: { x: 0, y: 0 }, detached: true });
    expect(detachedPlate.container.querySelector('.plate-btn-danger')).not.toBeNull();

    const armedPlate = renderPlate('CH-5', { ghost: { x: 0, y: 0 } });
    expect(armedPlate.container.querySelector('.plate-btn-danger')).toBeNull();
  });
});

describe('GridEditor plate views (docs/14 §8)', () => {
  it('offers the three overlays with state in aria, not colour alone', () => {
    const { container } = renderPlate('CH-5');
    const views = [...container.querySelectorAll('.plate-view')];

    expect(views.map((v) => v.textContent)).toEqual(['Parts', 'Power', 'Heat']);
    // .chip.active encoded state in colour only; aria-pressed carries it now.
    expect(views.map((v) => v.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('captions what the current colours mean', () => {
    const parts = renderPlate('CH-5');
    expect(parts.container.querySelector('.plate-caption')?.textContent)
      .toContain('part category');
  });

  it('reports the view change rather than owning it', () => {
    const seen: string[] = [];
    const chassis = getChassis('CH-5');
    const { container } = render(
      <GridEditor
        chassis={chassis} parts={[]} overlay="parts"
        selectedPartId={null} selectedInstanceId={null}
        previewCells={() => []} checkCandidate={() => null}
        ghost={null} detached={false}
        onAim={() => {}} onCommit={() => {}} onCancel={() => {}} onRotate={() => {}}
        onSetOverlay={(o) => seen.push(o)}
        onSelectInstance={() => {}}
        thermalSnapshot={null} faultInstanceIds={new Set()} flashInstanceIds={new Set()}
        onAutoWire={() => {}}
      />,
    );
    fireEvent.click(container.querySelectorAll('.plate-view')[1]);
    expect(seen).toEqual(['power']);
  });
});

describe('GridEditor second channel for state (docs/14 §9)', () => {
  it('hatches unpowered parts as well as colouring them', () => {
    const chassis = getChassis('CH-5');
    const { container } = render(
      <GridEditor
        chassis={chassis}
        // An unwired laser: placed, drawing power, and with no path to the core.
        parts={[{ instanceId: 'r1', partId: 'W-LAS', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 }]}
        overlay="power"
        selectedPartId={null} selectedInstanceId={null}
        previewCells={() => []} checkCandidate={() => null}
        ghost={null} detached={false}
        onAim={() => {}} onCommit={() => {}} onCancel={() => {}} onRotate={() => {}}
        onSetOverlay={() => {}} onSelectInstance={() => {}}
        thermalSnapshot={null} faultInstanceIds={new Set()} flashInstanceIds={new Set()}
        onAutoWire={() => {}}
      />,
    );

    // Colour is never the only channel, so red is backed by a hatch pattern.
    expect(container.querySelector('#hatch-unpowered')).not.toBeNull();
    expect(container.querySelectorAll('.cell-unpowered-hatch').length).toBeGreaterThan(0);
  });

  it('does not hatch outside the power view', () => {
    const chassis = getChassis('CH-5');
    const { container } = render(
      <GridEditor
        chassis={chassis}
        parts={[{ instanceId: 'r1', partId: 'W-LAS', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 }]}
        overlay="parts"
        selectedPartId={null} selectedInstanceId={null}
        previewCells={() => []} checkCandidate={() => null}
        ghost={null} detached={false}
        onAim={() => {}} onCommit={() => {}} onCancel={() => {}} onRotate={() => {}}
        onSetOverlay={() => {}} onSelectInstance={() => {}}
        thermalSnapshot={null} faultInstanceIds={new Set()} flashInstanceIds={new Set()}
        onAutoWire={() => {}}
      />,
    );
    expect(container.querySelectorAll('.cell-unpowered-hatch').length).toBe(0);
  });

  it('names the hatch in the power caption and legend', () => {
    const chassis = getChassis('CH-5');
    const { container } = render(
      <GridEditor
        chassis={chassis} parts={[]} overlay="power"
        selectedPartId={null} selectedInstanceId={null}
        previewCells={() => []} checkCandidate={() => null}
        ghost={null} detached={false}
        onAim={() => {}} onCommit={() => {}} onCancel={() => {}} onRotate={() => {}}
        onSetOverlay={() => {}} onSelectInstance={() => {}}
        thermalSnapshot={null} faultInstanceIds={new Set()} flashInstanceIds={new Set()}
        onAutoWire={() => {}}
      />,
    );
    // A second channel nobody explains is not a second channel.
    expect(container.querySelector('.plate-caption')?.textContent).toContain('hatched');
    expect(container.textContent).toContain('Unpowered (hatched)');
  });
});
