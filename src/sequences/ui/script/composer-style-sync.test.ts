import { describe, expect, it } from 'vitest';
import { resolveComposerStyleSync } from './composer-style-sync';
import type {
  ComposerStyleLocation,
  ComposerStyleSync,
} from './composer-style-sync';

describe('composer style URL synchronization', () => {
  it('preserves the composer before and after every repeated inspiration navigation', () => {
    let location: ComposerStyleLocation = {};
    for (const target of ['action', 'product-ad', 'pastel', 'action']) {
      const pending: ComposerStyleSync = { target, source: location };
      const beforeNavigation = resolveComposerStyleSync(pending, location);
      expect(beforeNavigation.isSelfSync).toBe(true);
      location = { style: target, prefill: 'style' };
      const afterNavigation = resolveComposerStyleSync(
        beforeNavigation.sync,
        location
      );
      expect(afterNavigation.isSelfSync).toBe(true);
      expect(afterNavigation.sync?.source).toBeNull();
    }
  });

  it('preserves a Try seed while its style selection is being echoed', () => {
    const source = { style: 'action' };
    const sync = { target: 'pastel', source };
    expect(resolveComposerStyleSync(sync, source).isSelfSync).toBe(true);
    expect(
      resolveComposerStyleSync(sync, { style: 'pastel', prefill: 'style' })
        .isSelfSync
    ).toBe(true);
  });

  it('treats a later visit to the previous style as a fresh navigation', () => {
    const completed = resolveComposerStyleSync(
      { target: 'pastel', source: { style: 'action', prefill: 'style' } },
      { style: 'pastel', prefill: 'style' }
    );
    expect(
      resolveComposerStyleSync(completed.sync, {
        style: 'action',
        prefill: 'style',
      })
    ).toEqual({ isSelfSync: false, sync: null });
  });

  it('allows a fresh Try navigation for the same selected style', () => {
    expect(
      resolveComposerStyleSync(
        { target: 'action', source: null },
        { style: 'action' }
      )
    ).toEqual({ isSelfSync: false, sync: null });
  });

  const externalLocations: ComposerStyleLocation[] = [
    {},
    { style: 'western' },
    { style: 'action', prefill: 'style' },
  ];
  it.each(externalLocations)(
    'allows external navigation to %j during a pending style echo',
    (location) => {
      expect(
        resolveComposerStyleSync(
          { target: 'pastel', source: { style: 'action' } },
          location
        )
      ).toEqual({ isSelfSync: false, sync: null });
    }
  );

  it('does not suppress initial URL seeding', () => {
    expect(resolveComposerStyleSync(null, { style: 'pastel' })).toEqual({
      isSelfSync: false,
      sync: null,
    });
  });
});
