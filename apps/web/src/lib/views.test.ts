import { describe, expect, it } from 'vitest';
import { DEV_ONLY_VIEWS, resolveView } from './views.js';

describe('resolveView', () => {
  it('passes navigation views through in production', () => {
    expect(resolveView('workshop', false)).toBe('workshop');
    expect(resolveView('balance', false)).toBe('balance');
  });

  it('drops every dev-only view in production', () => {
    for (const view of DEV_ONLY_VIEWS) {
      expect(resolveView(view, false), view).toBeNull();
    }
  });

  it('allows dev-only views in development', () => {
    for (const view of DEV_ONLY_VIEWS) {
      expect(resolveView(view, true), view).toBe(view);
    }
  });

  it('gates salvage, which would destroy a real run', () => {
    // startCustom overwrites the persisted campaign, so this one is not merely
    // pointless in production -- it is destructive.
    expect(DEV_ONLY_VIEWS).toContain('salvage');
    expect(resolveView('salvage', false)).toBeNull();
  });

  it('treats a missing view as no view', () => {
    expect(resolveView(null, true)).toBeNull();
    expect(resolveView('', true)).toBeNull();
  });
});
