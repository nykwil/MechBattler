import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SPATIAL_DEMO_TEMPLATE, getChassis, type Build } from '@mechbattler/sim';
import { PartInspector } from './PartInspector.js';

describe('PartInspector spatial consequences', () => {
  it('explains location, stack, cooling, power, heat, arc, and exposure together', () => {
    const build = structuredClone(SPATIAL_DEMO_TEMPLATE.build);
    const { container } = render(
      <PartInspector
        chassis={getChassis(build.chassisId)}
        build={build}
        selectedInstanceId="mg"
        onDetach={() => {}}
        onDeselect={() => {}}
      />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Left shoulder');
    expect(text).toContain('connected');
    expect(text).toContain('0/2 cells active');
    expect(text).toContain('Articulated shoulder');
    expect(text).toContain('90° + 25° location + 25° support = 140°');
    expect(text).toContain('×1.25');
    expect(text).toContain('Carapace → Stitcher → Gimbal');
    expect(text).toContain('Front 0 (+2 protected)');
    expect(text).toContain('Rear');
    expect(text).toContain('Right');
  });

  /**
   * The inspector kept its own copy of the power rule -- `draw || weapon` --
   * which misses capacitors, since both declare no `draw` at all. A fitted,
   * unwired capacitor therefore showed no power row while validation.ts
   * rejected the build for exactly it: the build was unlaunchable and the
   * screen that explains parts said nothing.
   */
  it('reports an unwired capacitor as unpowered rather than saying nothing', () => {
    const base = structuredClone(SPATIAL_DEMO_TEMPLATE.build);
    const build: Build = {
      ...base,
      // No route to it, so it cannot be on the power net.
      parts: [...base.parts, {
        instanceId: 'cap', partId: 'P-CAP',
        origin: { regionId: 'body', x: 0, y: 0 }, rotation: 0, integrity: 1,
      }],
    };
    const { container } = render(
      <PartInspector
        chassis={getChassis(build.chassisId)}
        build={build}
        selectedInstanceId="cap"
        onDetach={() => {}}
        onDeselect={() => {}}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Power network');
    expect(text).toContain('unpowered');
  });
});