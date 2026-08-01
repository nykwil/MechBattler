import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SPATIAL_DEMO_TEMPLATE, getChassis } from '@mechbattler/sim';
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
});
